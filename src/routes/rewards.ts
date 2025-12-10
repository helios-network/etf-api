import { Router, Request, Response } from "express"
import LeaderBoardRewards from "../models/LeaderBoardRewards"
import WalletHolding from "../models/WalletHolding"
import { privateKeyToAccount } from "viem/accounts"
import { SUPPORTED_ASSETS } from "../constants"
import { ChainId, publicClients, walletClients } from "../config/web3"
import { erc20Abi, verifyMessage } from "viem"

const router = Router()

// Global queue to process all claims sequentially (one at a time)
let claimQueue: Promise<void> = Promise.resolve()

router.get("/rewards_boost", async (_req: Request, res: Response) => {
  try {
    const leaderBoardRewards = await LeaderBoardRewards.find()
    return res.json({
      success: true,
      data: leaderBoardRewards.reverse(),
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
})

router.get("/:address", async (req: Request, res: Response) => {
  try {
    const { address } = req.params

    const walletHolding = await WalletHolding.findOne({
      wallet: { $regex: new RegExp(`^${address}$`, "i") },
    })

    if (!walletHolding) {
      return res.json({
        success: false,
        message: "Wallet not found",
      })
    }

    return res.json({
      success: true,
      data: walletHolding.rewards,
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
})

router.post("/:address/claim/:symbol", async (req: Request, res: Response) => {
  const { address, symbol } = req.params
  const { chainId, signature } = req.body

  // Add this claim to the queue - it will wait for all previous claims to complete
  const currentClaim = claimQueue.then(async () => {
    try {
      const walletHolding = await WalletHolding.findOne({
        wallet: { $regex: new RegExp(`^${address}$`, "i") },
      })

      if (!walletHolding) {
        return res.json({
          success: false,
          message: "Wallet not found",
        })
      }

      const rewards = walletHolding.rewards.filter(
        (reward) =>
          reward.chain === Number(chainId) &&
          reward.symbol === symbol &&
          !reward.hash
      )

      const totalAmount = rewards.reduce(
        (acc, reward) => acc + reward.amount,
        0n
      )

      const token = SUPPORTED_ASSETS[Number(chainId) as ChainId].find(
        (asset) => asset.symbol === symbol
      )

      const ownerAccount = privateKeyToAccount(
        process.env.PRIVATE_KEY as `0x${string}`
      )

      const verified = await verifyMessage({
        address: address as `0x${string}`,
        message: JSON.stringify({
          chainId: Number(chainId),
          symbol,
          amount: totalAmount,
          to: address as `0x${string}`,
        }),
        signature,
      })

      if (!verified) {
        return res.json({
          success: false,
          message: "Invalid signature",
        })
      }

      const walletClient = walletClients[Number(chainId) as ChainId]
      const publicClient = publicClients[Number(chainId) as ChainId]

      const { request } = await publicClient.simulateContract({
        account: ownerAccount,
        address: token?.address as `0x${string}`,
        abi: erc20Abi,
        functionName: "transfer",
        args: [address as `0x${string}`, totalAmount],
      })

      const tx = await walletClient.writeContract(request)

      await publicClient.waitForTransactionReceipt({
        hash: tx,
      })

      let updatedRewards = walletHolding.rewards.map((reward) => {
        if (reward.chain === Number(chainId) && reward.symbol === symbol) {
          return { ...reward, hash: tx }
        }
        return reward
      })
      walletHolding.rewards = updatedRewards
      await walletHolding.save()

      return res.status(201).json({
        success: true,
        data: {
          hash: tx,
        },
      })
    } catch (error) {
      console.error(error)
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }
  })

  // Update the queue to include this claim
  claimQueue = currentClaim.then(() => {
    // Queue continues after this claim completes
  })

  // Wait for this claim to complete
  return await currentClaim
})

export default router
