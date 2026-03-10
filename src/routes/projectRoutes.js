import express from "express";
import Project from "../db/models/project.model.js";
import Unit from "../db/models/unit.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import {
  validate,
  createProjectSchema,
} from "../middleware/validation.middleware.js";
import upload from "../config/cloudinary.js";

const router = express.Router();

// ==================== PUBLIC ROUTES ====================

// Get all projects
router.get("/", async (req, res) => {
  try {
    const projects = await Project.find().sort({ createdAt: -1 });

    // Attach unit stats to each project
    const projectsWithStats = await Promise.all(
      projects.map(async (project) => {
        const unitStats = await Unit.aggregate([
          { $match: { project: project._id } },
          {
            $group: {
              _id: "$status",
              count: { $sum: 1 },
            },
          },
        ]);

        const stats = {
          total: 0,
          available: 0,
          reserved: 0,
          sold: 0,
        };

        unitStats.forEach((s) => {
          stats[s._id] = s.count;
          stats.total += s.count;
        });

        return {
          ...project.toObject(),
          unit_stats: stats,
        };
      }),
    );

    res.json(projectsWithStats);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single project with its blocks and available units count
router.get("/:id", async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Get unit statistics for this project
    const unitStats = await Unit.aggregate([
      { $match: { project: project._id } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Get price range
    const priceRange = await Unit.aggregate([
      { $match: { project: project._id } },
      {
        $group: {
          _id: null,
          min_price: { $min: "$price" },
          max_price: { $max: "$price" },
          avg_price: { $avg: "$price" },
        },
      },
    ]);

    const stats = { total: 0, available: 0, reserved: 0, sold: 0 };
    unitStats.forEach((s) => {
      stats[s._id] = s.count;
      stats.total += s.count;
    });

    res.json({
      ...project.toObject(),
      unit_stats: stats,
      price_range: priceRange[0] || {
        min_price: 0,
        max_price: 0,
        avg_price: 0,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== PROTECTED ROUTES ====================

// Create project (manager/admin only)
router.post(
  "/",
  authMiddleware,
  authorize("admin", "manager"),
  upload.array("images", 10),
  async (req, res) => {
    try {
      const projectData = { ...req.body };

      // Parse location if sent as JSON string
      if (typeof projectData.location === "string") {
        projectData.location = JSON.parse(projectData.location);
      }

      // Parse amenities if sent as JSON string
      if (typeof projectData.amenities === "string") {
        projectData.amenities = JSON.parse(projectData.amenities);
      }

      // Handle images
      if (req.files && req.files.length > 0) {
        projectData.images = req.files.map((file) => ({
          url: file.path,
          public_id: file.filename,
        }));

        // First image as hero image
        projectData.hero_image = {
          url: req.files[0].path,
          public_id: req.files[0].filename,
        };
      }

      const project = new Project(projectData);
      await project.save();

      res.status(201).json({ message: "Project created", project });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Update project (manager/admin only)
router.put(
  "/:id",
  authMiddleware,
  authorize("admin", "manager"),
  upload.array("images", 10),
  async (req, res) => {
    try {
      const updates = { ...req.body };

      // Parse location if sent as JSON string
      if (typeof updates.location === "string") {
        updates.location = JSON.parse(updates.location);
      }

      // Parse amenities if sent as JSON string
      if (typeof updates.amenities === "string") {
        updates.amenities = JSON.parse(updates.amenities);
      }

      // Handle new images
      if (req.files && req.files.length > 0) {
        const newImages = req.files.map((file) => ({
          url: file.path,
          public_id: file.filename,
        }));

        // Append to existing images
        const project = await Project.findById(req.params.id);
        if (project) {
          updates.images = [...(project.images || []), ...newImages];
        }
      }

      const project = await Project.findByIdAndUpdate(req.params.id, updates, {
        new: true,
        runValidators: true,
      });

      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }

      res.json({ message: "Project updated", project });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Delete project (admin only)
router.delete("/:id", authMiddleware, authorize("admin"), async (req, res) => {
  try {
    // Check if project has units
    const unitCount = await Unit.countDocuments({ project: req.params.id });
    if (unitCount > 0) {
      return res.status(400).json({
        message: `Cannot delete project. It has ${unitCount} units. Delete units first.`,
      });
    }

    const project = await Project.findByIdAndDelete(req.params.id);

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    res.json({ message: "Project deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
