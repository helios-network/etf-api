import {
  Controller,
  Get,
  Param,
  Query,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { GetPortfolioAssetsDto } from './dto/get-portfolio.dto';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  /**
   * Validate Ethereum address format
   */
  private validateAddress(address: string): string {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new BadRequestException({
        success: false,
        error: 'Invalid Ethereum address format',
      });
    }
    return address.toLowerCase();
  }

  @Get(':address')
  async getPortfolio(@Param('address') address: string) {
    try {
      const normalizedAddress = this.validateAddress(address);
      const result = await this.portfolioService.getPortfolio(normalizedAddress);

      if (!result.success) {
        throw new HttpException(
          {
            success: false,
            message: result.message || 'Wallet not found',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          error:
            error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':address/assets')
  async getPortfolioAssets(
    @Param('address') address: string,
    @Query() query: GetPortfolioAssetsDto,
  ) {
    try {
      const normalizedAddress = this.validateAddress(address);
      const result = await this.portfolioService.getPortfolioAssets(
        normalizedAddress,
        query.chain,
        query.symbol,
      );

      if (!result.success) {
        throw new HttpException(
          {
            success: false,
            message: result.message || 'Wallet not found',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: result.data || [],
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          error:
            error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':address/summary')
  async getPortfolioSummary(@Param('address') address: string) {
    try {
      const normalizedAddress = this.validateAddress(address);
      const result =
        await this.portfolioService.getPortfolioSummary(normalizedAddress);

      if (!result.success) {
        throw new HttpException(
          {
            success: false,
            message: result.message || 'Wallet not found',
          },
          HttpStatus.NOT_FOUND,
        );
      }

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          error:
            error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

