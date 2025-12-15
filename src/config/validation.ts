import * as Joi from 'joi';
import * as os from 'os';

const defaultWorkerCount = Math.max(1, os.cpus().length - 1);

export const validationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  MONGODB_URI: Joi.string().required(),
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_TTL: Joi.number().default(3600),
  CACHE_ENABLED: Joi.string()
    .valid('true', 'false', '1', '0')
    .default('true'),
  CACHE_NAMESPACE: Joi.string().default('etf_api'),
  CACHE_TTL: Joi.number().min(1).default(300),
  CORS_ENABLED: Joi.string()
    .valid('true', 'false', '1', '0')
    .optional(),
  CORS_ORIGINS: Joi.string().optional(),
  RATE_LIMIT_ENABLED: Joi.string()
    .valid('true', 'false', '1', '0')
    .default('true'),
  RATE_LIMIT_WINDOW_MS: Joi.number().min(1000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().min(1).default(100),
  RATE_LIMIT_NAMESPACE: Joi.string().default('ratelimit'),
  PRIVATE_KEY: Joi.string()
    .required().messages({
      'any.required': 'PRIVATE_KEY is required for reward claims',
    }),
  DEBUG_TVL: Joi.string()
    .valid('true', 'false', '1', '0')
    .optional(),
  APP_ROLE: Joi.string()
    .valid('master', 'worker')
    .required()
    .messages({
      'any.required': 'APP_ROLE is required (must be "master" or "worker")',
      'any.only': 'APP_ROLE must be either "master" or "worker"',
    }),
  WORKER_COUNT: Joi.number()
    .integer()
    .min(1)
    .default(defaultWorkerCount),
});

