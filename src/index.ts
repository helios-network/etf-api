import express, { Request, Response, NextFunction } from "express"
import dotenv from "dotenv"
import { connectDatabase } from "./config/database"
import rewardsRoutes from "./routes/rewards"

import "./jobs/event"
import "./jobs/reward"

// Load environment variables
dotenv.config()

const app = express()
const PORT = process.env.PORT || 8000

// Middleware
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`)
  next()
})

// Routes
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Welcome to Helios ETF API",
    status: "running",
    timestamp: new Date().toISOString(),
  })
})

app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

// API routes
app.use("/api/rewards", rewardsRoutes)

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.path} not found`,
  })
})

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("Error:", err)
  res.status(500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  })
})

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDatabase()

    // Start Express server
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`)
      console.log(`📝 Environment: ${process.env.NODE_ENV || "development"}`)
    })
  } catch (error) {
    console.error("Failed to start server:", error)
    process.exit(1)
  }
}

startServer()

export default app
