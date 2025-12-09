import { Router, Request, Response } from "express"
import ETF from "../models/ETF"

const router = Router()

router.get("/", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const size = parseInt(req.query.size as string) || 10

    // Validate pagination parameters
    if (page < 1) {
      return res.status(400).json({
        success: false,
        error: "Page must be greater than 0",
      })
    }

    if (size < 1 || size > 100) {
      return res.status(400).json({
        success: false,
        error: "Size must be between 1 and 100",
      })
    }

    // Calculate skip value
    const skip = (page - 1) * size

    // Get total count for pagination metadata
    const total = await ETF.countDocuments()

    // Fetch ETFs with pagination
    const etfs = await ETF.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(size)
      .lean()

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / size)
    const hasNextPage = page < totalPages
    const hasPreviousPage = page > 1

    return res.json({
      success: true,
      data: etfs,
      pagination: {
        page,
        size,
        total,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      },
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
})

export default router

