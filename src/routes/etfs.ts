import { Router, Request, Response } from "express"
import ETF from "../models/ETF"
import { publicClients, ChainId } from "../config/web3"
import { resolveToken, getTokenMetadata } from "../services/etfResolver"
import {
  VerifyRequest,
  VerifyResponse,
  VerifySuccessResponse,
  VerifyErrorResponse,
  ComponentVerification,
} from "../types/etfVerify"
import { MIN_LIQUIDITY_USD } from "../constants"

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

/**
 * POST /etf/verify
 * Verify liquidity, pricing mode, feeds Chainlink and swap paths for ETF creation
 */
router.post("/verify", async (req: Request, res: Response) => {
  try {
    const body = req.body as VerifyRequest

    console.log("body", body)
    // Validate input
    if (!body.chainId || !body.depositToken || !body.components || !Array.isArray(body.components)) {
      const errorResponse: VerifyErrorResponse = {
        status: "ERROR",
        reason: "INVALID_INPUT",
        details: {
          token: "",
          message: "Missing required fields: chainId, depositToken, or components",
        },
      }
      return res.status(400).json(errorResponse)
    }

    if (body.components.length === 0) {
      const errorResponse: VerifyErrorResponse = {
        status: "ERROR",
        reason: "INVALID_INPUT",
        details: {
          token: "",
          message: "Components array cannot be empty",
        },
      }
      return res.status(400).json(errorResponse)
    }

    // Validate weights sum to 100
    const totalWeight = body.components.reduce((sum, comp) => sum + comp.weight, 0)
    if (Math.abs(totalWeight - 100) > 0.01) {
      const errorResponse: VerifyErrorResponse = {
        status: "ERROR",
        reason: "INVALID_INPUT",
        details: {
          token: "",
          message: `Weights must sum to 100, got ${totalWeight}`,
        },
      }
      return res.status(400).json(errorResponse)
    }

    // Get blockchain client
    const chainId = body.chainId as ChainId
    if (!publicClients[chainId]) {
      const errorResponse: VerifyErrorResponse = {
        status: "ERROR",
        reason: "INVALID_INPUT",
        details: {
          token: "",
          message: `Unsupported chainId: ${chainId}`,
        },
      }
      return res.status(400).json(errorResponse)
    }

    const client = publicClients[chainId]
    const depositToken = body.depositToken as `0x${string}`

    console.log("depositToken", depositToken)

    // Get deposit token metadata
    let depositTokenMetadata
    try {
      depositTokenMetadata = await getTokenMetadata(client, depositToken)
    } catch (error) {
      const errorResponse: VerifyErrorResponse = {
        status: "ERROR",
        reason: "INVALID_INPUT",
        details: {
          token: depositToken,
          message: `Failed to fetch deposit token metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      }
      return res.status(400).json(errorResponse)
    }

    // Verify all components
    const componentVerifications: ComponentVerification[] = []

    for (const component of body.components) {
      const targetToken = component.token as `0x${string}`

      console.log("targetToken", targetToken)
      console.log("depositToken", depositToken)

      // Skip if target token is the same as deposit token (case-insensitive comparison)
      if (targetToken.toLowerCase() === depositToken.toLowerCase()) {
        continue
      }

      try {
        // Get target token metadata
        const targetTokenMetadata = await getTokenMetadata(client, targetToken)

        // Resolve token (follows strict pipeline)
        const resolution = await resolveToken(
          client,
          depositToken,
          targetToken,
          chainId,
          depositTokenMetadata,
          targetTokenMetadata
        )

        // Build component verification result
        const componentVerification: ComponentVerification = {
          token: targetTokenMetadata.symbol,
          symbol: targetTokenMetadata.symbol,
          decimals: targetTokenMetadata.decimals,
          pricingMode: resolution.pricingMode,
          feed: resolution.feed?.proxyAddress || null,
          depositPath: resolution.depositPath,
          withdrawPath: resolution.withdrawPath,
          liquidityUSD: resolution.liquidityUSD,
        }

        componentVerifications.push(componentVerification)
      } catch (error) {
        // If resolution fails, return error immediately
        let targetSymbol = component.token
        try {
          const metadata = await getTokenMetadata(client, targetToken)
          targetSymbol = metadata.symbol
        } catch {
          // Keep original token address if metadata fetch fails
        }

        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        const isLiquidityError = errorMessage.includes("Insufficient liquidity") || errorMessage.includes("no pools")

        const errorResponse: VerifyErrorResponse = {
          status: "ERROR",
          reason: isLiquidityError ? "INSUFFICIENT_LIQUIDITY" : "NO_POOL_FOUND",
          details: {
            token: targetSymbol,
            requiredUSD: MIN_LIQUIDITY_USD,
            message: errorMessage,
          },
        }

        return res.status(400).json(errorResponse)
      }
    }

    // All components verified successfully
    const successResponse: VerifySuccessResponse = {
      status: "OK",
      readyForCreation: true,
      components: componentVerifications,
    }

    return res.json(successResponse)
  } catch (error) {
    console.error("Error in /etf/verify endpoint:", error)
    const errorResponse: VerifyErrorResponse = {
      status: "ERROR",
      reason: "INTERNAL_ERROR",
      details: {
        token: "",
        message: error instanceof Error ? error.message : "Unknown error occurred",
      },
    }
    return res.status(500).json(errorResponse)
  }
})

export default router

