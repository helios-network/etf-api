import {
  IsNumber,
  IsString,
  IsArray,
  ValidateNested,
  IsNotEmpty,
  ArrayMinSize,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

class ComponentDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  weight: number;
}

export class VerifyEtfDto {
  @IsNumber()
  @IsNotEmpty()
  chainId: number;

  @IsString()
  @IsNotEmpty()
  depositToken: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ComponentDto)
  components: ComponentDto[];
}
