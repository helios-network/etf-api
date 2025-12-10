import { Router, Request, Response } from "express"
import ChainlinkDataFeed from "../models/ChainlinkDataFeed"
import { syncChainlinkFeeds } from "../jobs/chainlink"

const router = Router()

router.get("/", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1
    const size = parseInt(req.query.size as string) || 10
    const chainId = req.query.chainId
      ? parseInt(req.query.chainId as string)
      : undefined
    const feedCategory = req.query.feedCategory as string | undefined
    const feedType = req.query.feedType as string | undefined
    const status = req.query.status as string | undefined

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

    // Build query filters
    const query: any = {}
    if (chainId !== undefined) {
      query.sourceChain = chainId
    }
    if (feedCategory) {
      query.feedCategory = feedCategory
    }
    if (feedType) {
      query.feedType = feedType
    }
    if (status) {
      query.status = status
    }

    // Calculate skip value
    const skip = (page - 1) * size

    // Get total count for pagination metadata
    const total = await ChainlinkDataFeed.countDocuments(query)

    // Fetch feeds with pagination
    const feeds = await ChainlinkDataFeed.find(query)
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
      data: feeds,
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

router.post("/reload", async (req: Request, res: Response) => {
  try {
    console.log("[Chainlink Reload] Manual sync triggered via API")
    
    await syncChainlinkFeeds()
    
    return res.json({
      success: true,
      message: "Chainlink feeds synchronization completed successfully",
    })
  } catch (error) {
    console.error("[Chainlink Reload] Error during manual sync:", error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
})

export default router

