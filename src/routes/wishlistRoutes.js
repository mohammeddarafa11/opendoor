import express from "express";
import { authMiddleware } from "../middleware/auth.middleware.js";
import Wishlist from "../db/models/wishlist.model.js";

const router = express.Router();

// ─── GET /api/wishlist — Get current user's wishlist ────────────────
router.get("/", authMiddleware, async (req, res) => {
  try {
    const wishlist = await Wishlist.find({ user: req.userId })
      .populate("unit")
      .sort({ createdAt: -1 });

    res.json(wishlist);
  } catch (error) {
    console.error("Get wishlist error:", error);
    res.status(500).json({ message: "Failed to fetch wishlist" });
  }
});

// ─── GET /api/wishlist/my — Alias for above ─────────────────────────
router.get("/my", authMiddleware, async (req, res) => {
  try {
    const wishlist = await Wishlist.find({ user: req.userId })
      .populate("unit")
      .sort({ createdAt: -1 });

    res.json(wishlist);
  } catch (error) {
    console.error("Get wishlist error:", error);
    res.status(500).json({ message: "Failed to fetch wishlist" });
  }
});

// ─── GET /api/wishlist/check/:unitId — Check if unit is wishlisted ──
router.get("/check/:unitId", authMiddleware, async (req, res) => {
  try {
    const exists = await Wishlist.findOne({
      user: req.userId,
      unit: req.params.unitId,
    });

    res.json({ isWishlisted: !!exists, wishlistId: exists?._id || null });
  } catch (error) {
    console.error("Check wishlist error:", error);
    res.status(500).json({ message: "Failed to check wishlist" });
  }
});

// ─── POST /api/wishlist/toggle — Add/remove from wishlist ───────────
router.post("/toggle", authMiddleware, async (req, res) => {
  try {
    const { unit } = req.body;

    if (!unit) {
      return res.status(400).json({ message: "Unit ID is required" });
    }

    const existing = await Wishlist.findOne({ user: req.userId, unit });

    if (existing) {
      await Wishlist.findByIdAndDelete(existing._id);
      return res.json({
        message: "Removed from wishlist",
        isWishlisted: false,
      });
    }

    const wishlistItem = await Wishlist.create({
      user: req.userId,
      unit,
    });

    res.status(201).json({
      message: "Added to wishlist",
      isWishlisted: true,
      wishlistItem,
    });
  } catch (error) {
    console.error("Toggle wishlist error:", error);

    if (error.code === 11000) {
      return res.status(400).json({ message: "Already in wishlist" });
    }

    res.status(500).json({ message: "Failed to toggle wishlist" });
  }
});

// ─── DELETE /api/wishlist/:id — Remove from wishlist ────────────────
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const item = await Wishlist.findOneAndDelete({
      _id: req.params.id,
      user: req.userId,
    });

    if (!item) {
      return res.status(404).json({ message: "Wishlist item not found" });
    }

    res.json({ message: "Removed from wishlist" });
  } catch (error) {
    console.error("Remove wishlist error:", error);
    res.status(500).json({ message: "Failed to remove from wishlist" });
  }
});

export default router;
