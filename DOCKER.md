# Docker Setup Guide

This guide explains how to run the Helios Etf api using Docker.

## Prerequisites

- Docker (version 20.10 or higher)
- Docker Compose (version 2.0 or higher)

## Quick Start

1. **Create a `.env` file** in the root directory with your environment variables:

```env
NODE_ENV=production
PORT=8000
MONGODB_URI=mongodb://mongodb:27017/etf-api
PRIVATE_KEY=your_private_key_here
# Add other required environment variables
```

2. **Build and start the services**:

```bash
docker-compose up -d
```

3. **View logs**:

```bash
docker-compose logs -f app
```

4. **Stop the services**:

```bash
docker-compose down
```

## Docker Commands

### Build the image

```bash
docker-compose build
```

### Start services in detached mode

```bash
docker-compose up -d
```

### View logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f app
docker-compose logs -f mongodb
```

### Stop services

```bash
docker-compose down
```

### Stop and remove volumes (⚠️ This will delete MongoDB data)

```bash
docker-compose down -v
```

### Rebuild after code changes

```bash
docker-compose up -d --build
```

### Execute commands in running container

```bash
docker-compose exec app sh
```

## Services

### Application (`app`)
- **Port**: 8000 (configurable via `PORT` env variable)
- **Health Check**: Available at `http://localhost:8000/health`
- **Depends on**: MongoDB service

### MongoDB (`mongodb`)
- **Port**: 27017
- **Database**: `etf-api`
- **Data Persistence**: Stored in Docker volume `mongodb_data`

## Development Mode

For development with hot reload, use the development override file:

```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This will:
- Mount your source code for live reloading
- Install all dependencies including dev dependencies
- Run the app in development mode with `ts-node-dev`

The development setup uses `Dockerfile.dev` which includes all dev dependencies needed for hot reloading.

## Production Deployment

1. Ensure all environment variables are set in `.env` file
2. Build the production image:
   ```bash
   docker-compose build
   ```
3. Start the services:
   ```bash
   docker-compose up -d
   ```

## Troubleshooting

### Check container status

```bash
docker-compose ps
```

### View container logs

```bash
docker-compose logs app
```

### Restart a service

```bash
docker-compose restart app
```

### Access MongoDB shell

```bash
docker-compose exec mongodb mongosh etf-api
```

### Remove everything and start fresh

```bash
docker-compose down -v
docker-compose up -d --build
```

## Environment Variables

Required environment variables (add to `.env` file):

- `NODE_ENV`: Environment mode (development/production)
- `PORT`: Application port (default: 8000)
- `MONGODB_URI`: MongoDB connection string (default: mongodb://mongodb:27017/etf-api)
- `PRIVATE_KEY`: Private key for Web3 operations
- Add other required variables as per your application needs

## Security Notes

- The Dockerfile uses a non-root user for security
- Never commit `.env` files to version control
- Use Docker secrets or environment variable management in production
- Keep your `PRIVATE_KEY` secure and never expose it

