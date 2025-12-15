import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

@Injectable()
export class MongoService implements OnModuleInit {
  constructor(@InjectConnection() private connection: Connection) {}

  async onModuleInit() {
    if (this.connection.readyState === 1) {
      console.log('MongoDB Atlas connected successfully');
    } else {
      console.warn('MongoDB connection state:', this.connection.readyState);
    }
  }

  getConnection(): Connection {
    return this.connection;
  }
}

