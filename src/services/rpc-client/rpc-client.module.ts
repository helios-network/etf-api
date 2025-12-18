import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RpcClientService } from './rpc-client.service';
import { RpcRateLimitModule } from '../rpc-rate-limit/rpc-rate-limit.module';

@Module({
  imports: [ConfigModule, RpcRateLimitModule],
  providers: [RpcClientService],
  exports: [RpcClientService, RpcRateLimitModule],
})
export class RpcClientModule {}

