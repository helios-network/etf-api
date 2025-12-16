import { IsOptional, IsNumber, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class GetPortfolioAssetsDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  chain?: number;

  @IsOptional()
  @IsString()
  symbol?: string;
}

