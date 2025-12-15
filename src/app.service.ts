import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getWelcome() {
    return {
      message: 'Welcome to Helios ETF API',
      status: 'running',
      timestamp: new Date().toISOString(),
    };
  }
}
