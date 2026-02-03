import {
  Controller,
  Get,
  Param,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { handleError } from 'src/utils/error';

import { PortfolioService } from './portfolio.service';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) { }

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
  async getPortfolioAll(@Param('address') address: string) {
    try {
      const normalizedAddress = this.validateAddress(address);
      const result = await this.portfolioService.getPortfolioAll(normalizedAddress);

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
      handleError(error)
    }
  }
}

