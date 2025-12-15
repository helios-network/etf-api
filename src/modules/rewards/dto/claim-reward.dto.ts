import { IsNumber, IsString, IsNotEmpty } from 'class-validator';

export class ClaimRewardDto {
  @IsNumber()
  @IsNotEmpty()
  chainId: number;

  @IsString()
  @IsNotEmpty()
  signature: string;
}
