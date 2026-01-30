import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EtfPriceChart, EtfPriceChartDocument } from 'src/models';
import { normalizeEthAddress } from 'src/common/utils/eip55';

export type ChartPeriod = '24h' | '7d' | '1m' | 'all';

export interface ChartDataPoint {
  timestamp: number;
  volume: {
    min: number;
    average: number;
    max: number;
  };
  price: {
    min: number;
    average: number;
    max: number;
  };
}

@Injectable()
export class EtfPriceChartService {
  private readonly logger = new Logger(EtfPriceChartService.name);

  constructor(
    @InjectModel(EtfPriceChart.name)
    private etfPriceChartModel: Model<EtfPriceChartDocument>,
  ) {}

  /**
   * Add a price chart entry for an ETF
   */
  async addPriceChartEntry(
    vaultAddress: string,
    volumeUSD: number,
    sharePrice: number,
    timestamp: number = Date.now(),
  ): Promise<void> {
    const normalizedVault = normalizeEthAddress(vaultAddress);

    // Find or create price chart document
    let priceChart = await this.etfPriceChartModel.findOne({
      vaultAddress: normalizedVault,
    });

    if (!priceChart) {
      priceChart = await this.etfPriceChartModel.create({
        vaultAddress: normalizedVault,
        entries: [],
      });
    }

    // Add new entry
    priceChart.entries.push({
      timestamp,
      volumeUSD,
      sharePrice,
    });
    priceChart.markModified('entries');

    await priceChart.save();
  }

  /**
   * Get chart data aggregated by period
   */
  async getChartData(
    vaultAddress: string,
    period: ChartPeriod,
  ): Promise<ChartDataPoint[]> {
    const normalizedVault = normalizeEthAddress(vaultAddress);

    const priceChart = await this.etfPriceChartModel.findOne({
      vaultAddress: normalizedVault,
    });

    if (!priceChart || !priceChart.entries || priceChart.entries.length === 0) {
      return [];
    }

    // Calculate time range based on period
    const now = Date.now();
    let startTime: number;
    let barIntervalMs: number;

    switch (period) {
      case '24h':
        startTime = now - 24 * 60 * 60 * 1000;
        barIntervalMs = 60 * 1000; // 1 minute
        break;
      case '7d':
        startTime = now - 7 * 24 * 60 * 60 * 1000;
        barIntervalMs = 60 * 60 * 1000; // 1 hour
        break;
      case '1m':
        startTime = now - 30 * 24 * 60 * 60 * 1000;
        barIntervalMs = 24 * 60 * 60 * 1000; // 1 day
        break;
      case 'all':
        startTime = 0;
        barIntervalMs = 24 * 60 * 60 * 1000; // 1 day
        break;
      default:
        throw new Error(`Invalid period: ${period}`);
    }

    // Filter entries within the time range
    const filteredEntries = priceChart.entries.filter(
      (entry) => entry.timestamp >= startTime,
    );

    if (filteredEntries.length === 0) {
      return [];
    }

    // Group entries by time bar
    const barMap = new Map<number, typeof filteredEntries>();

    for (const entry of filteredEntries) {
      // Calculate which bar this entry belongs to
      const barStart =
        Math.floor(entry.timestamp / barIntervalMs) * barIntervalMs;
      if (!barMap.has(barStart)) {
        barMap.set(barStart, []);
      }
      barMap.get(barStart)!.push(entry);
    }

    // Aggregate data for each bar
    const chartData: ChartDataPoint[] = [];

    // Sort bars by timestamp
    const sortedBars = Array.from(barMap.keys()).sort((a, b) => a - b);

    for (const barStart of sortedBars) {
      const entries = barMap.get(barStart)!;

      // Calculate min, average, max for volume
      const volumes = entries.map((e) => e.volumeUSD);
      const volumeMin = Math.min(...volumes);
      const volumeMax = Math.max(...volumes);
      const volumeAvg = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;

      // Calculate min, average, max for price
      const prices = entries.map((e) => e.sharePrice);
      const priceMin = Math.min(...prices);
      const priceMax = Math.max(...prices);
      const priceAvg = prices.reduce((sum, p) => sum + p, 0) / prices.length;

      chartData.push({
        timestamp: barStart,
        volume: {
          min: Number(volumeMin.toFixed(2)),
          average: Number(volumeAvg.toFixed(2)),
          max: Number(volumeMax.toFixed(2)),
        },
        price: {
          min: Number(priceMin.toFixed(2)),
          average: Number(priceAvg.toFixed(2)),
          max: Number(priceMax.toFixed(2)),
        },
      });
    }

    return chartData;
  }

  /**
   * Initialize price chart document for a new ETF
   */
  async initializePriceChart(vaultAddress: string): Promise<void> {
    const normalizedVault = normalizeEthAddress(vaultAddress);

    const existing = await this.etfPriceChartModel.findOne({
      vaultAddress: normalizedVault,
    });

    if (!existing) {
      await this.etfPriceChartModel.create({
        vaultAddress: normalizedVault,
        entries: [],
      });
    }
  }
}
