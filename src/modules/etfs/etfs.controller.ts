import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { EtfsService } from './etfs.service';
import { VerifyEtfDto } from './dto/verify-etf.dto';

@Controller('etfs')
export class EtfsController {
  constructor(private readonly etfsService: EtfsService) {}

  @Get()
  async getAll(@Query('page') page?: string, @Query('size') size?: string, @Query('search') search?: string) {
    try {
      const pageNum = parseInt(page || '1', 10);
      const sizeNum = parseInt(size || '10', 10);

      const result = await this.etfsService.getAll(pageNum, sizeNum, search);
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('must be')) {
        throw new BadRequestException({
          success: false,
          error: error.message,
        });
      }
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('deposit-tokens')
  async getDepositTokens(@Query('chainId') chainId: number, @Query('search') search?: string) {
    try {
      return await this.etfsService.getDepositTokens(chainId, search);
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('verify')
  async verifyETF(@Body() body: VerifyEtfDto) {
    try {
      const result = await this.etfsService.verifyETF(body);

      // Check if it's an error response
      if (result.status === 'ERROR') {
        throw new BadRequestException(result);
      }

      return result;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      // Internal error
      throw new HttpException(
        {
          status: 'ERROR',
          reason: 'INTERNAL_ERROR',
          details: {
            token: '',
            message: error instanceof Error ? error.message : 'Unknown error occurred',
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
