import express from "express";
import jwt from "jsonwebtoken";
import User from "../db/models/User.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import {
  validate,
  registerSchema,
  loginSchema,
  changePasswordSchema,
  createStaffSchema,
} from "../middleware/validation.middleware.js";

const router = express.Router();

// Helper: generate JWT
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
};

// ==================== PUBLIC ROUTES ====================

// Register customer
router.post("/register", validate(registerSchema), async (req, res) => {
  try {
    const { name, email, password, phone, national_id, address } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // Check phone uniqueness
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res
        .status(400)
        .json({ message: "Phone number already registered" });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      phone,
      national_id: national_id || undefined,
      address: address || undefined,
      role: "customer",
    });

    // Generate token
    const token = generateToken(user._id);

    // Update last login
    user.last_login = new Date();
    await user.save();

    res.status(201).json({
      message: "Registration successful",
      token,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("Register error:", error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      return res.status(400).json({ message: `${field} already exists` });
    }

    res.status(500).json({ message: "Registration failed" });
  }
});

// Login
router.post("/login", validate(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user WITH password field (it's select: false by default)
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Check if account is active
    if (!user.is_active) {
      return res.status(403).json({ message: "Account has been suspended" });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Generate token
    const token = generateToken(user._id);

    // Update last login
    user.last_login = new Date();
    await user.save();

    res.json({
      message: "Login successful",
      token,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Login failed" });
  }
});

// ==================== PROTECTED ROUTES ====================

// Get current user profile
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ user });
  } catch (error) {
    console.error("Get me error:", error);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

// Update profile
router.put("/me", authMiddleware, async (req, res) => {
  try {
    const allowedUpdates = ["name", "phone", "address", "national_id"];
    const updates = {};

    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    const user = await User.findByIdAndUpdate(req.userId, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Profile updated", user });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// Change password
router.put(
  "/change-password",
  authMiddleware,
  validate(changePasswordSchema),
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;

      const user = await User.findById(req.userId).select("+password");
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const isMatch = await user.comparePassword(currentPassword);
      if (!isMatch) {
        return res
          .status(400)
          .json({ message: "Current password is incorrect" });
      }

      user.password = newPassword;
      await user.save();

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  },
);

// Upload document
router.post("/documents", authMiddleware, async (req, res) => {
  try {
    const { name, url, type } = req.body;

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.documents.push({ name, url, type });
    await user.save();

    res.status(201).json({
      message: "Document uploaded",
      documents: user.documents,
    });
  } catch (error) {
    console.error("Upload document error:", error);
    res.status(500).json({ message: "Failed to upload document" });
  }
});

// Get documents
router.get("/documents", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("documents");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ documents: user.documents });
  } catch (error) {
    console.error("Get documents error:", error);
    res.status(500).json({ message: "Failed to fetch documents" });
  }
});

// Create staff (manager/admin only)
router.post(
  "/create-staff",
  authMiddleware,
  authorize("manager", "admin"),
  validate(createStaffSchema),
  async (req, res) => {
    try {
      const { name, email, password, phone, role, sales_target } = req.body;

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: "Email already registered" });
      }

      const user = await User.create({
        name,
        email,
        password,
        phone,
        role,
        sales_target: sales_target || 0,
      });

      res.status(201).json({
        message: `${role} account created successfully`,
        user: user.toJSON(),
      });
    } catch (error) {
      console.error("Create staff error:", error);
      res.status(500).json({ message: "Failed to create staff account" });
    }
  },
);

export default router;
