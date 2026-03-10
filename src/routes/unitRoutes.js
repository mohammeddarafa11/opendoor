import express from "express";
import Unit from "../db/models/unit.model.js";
import Project from "../db/models/project.model.js";
import ActivityLog from "../db/models/ActivityLog.model.js";
import { authMiddleware } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import {
  validate,
  createUnitSchema,
  updateUnitSchema,
} from "../middleware/validation.middleware.js";
import upload from "../config/cloudinary.js";

const router = express.Router();

// ==================== PUBLIC ROUTES ====================

// Get all units with advanced filtering
router.get("/", async (req, res) => {
  try {
    const {
      property_type,
      minPrice,
      maxPrice,
      bedrooms,
      bathrooms,
      amenities,
      sort,
      project,
      block,
      status,
      has_garden,
      view_type,
      finishing,
      minArea,
      maxArea,
      floor,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    let query = {};

    // Basic filters
    if (project) query.project = project;
    if (block) query.block = block;
    if (status) query.status = status;
    if (has_garden !== undefined) query.has_garden = has_garden === "true";

    // View type filter
    if (view_type) {
      const views = Array.isArray(view_type) ? view_type : view_type.split(",");
      query.view_type = { $in: views };
    }

    // Finishing filter
    if (finishing) {
      const finishTypes = Array.isArray(finishing)
        ? finishing
        : finishing.split(",");
      query.finishing = { $in: finishTypes };
    }

    // Floor filter
    if (floor) query.floor = Number(floor);

    // Property Type Filter (supports multiple)
    if (property_type) {
      const types = Array.isArray(property_type)
        ? property_type
        : property_type.split(",");
      query.property_type = { $in: types };
    }

    // Search by unit number
    if (search) {
      query.unit_number = { $regex: search, $options: "i" };
    }

    // Initialize $and array for complex bedroom/bathroom logic
    const andConditions = [];

    // Bedrooms filter (FIXED: handles Studio and 7+ correctly)
    if (bedrooms) {
      const bedroomValues = Array.isArray(bedrooms)
        ? bedrooms
        : bedrooms.split(",");

      const bedroomQueries = [];
      let has7Plus = false;

      bedroomValues.forEach((val) => {
        if (val === "Studio" || val === "0") {
          bedroomQueries.push(0);
        } else if (val === "7+") {
          has7Plus = true;
        } else {
          const num = Number(val);
          if (!isNaN(num)) bedroomQueries.push(num);
        }
      });

      if (has7Plus && bedroomQueries.length > 0) {
        andConditions.push({
          $or: [
            { bedrooms: { $in: bedroomQueries } },
            { bedrooms: { $gte: 7 } },
          ],
        });
      } else if (has7Plus) {
        query.bedrooms = { $gte: 7 };
      } else if (bedroomQueries.length > 0) {
        query.bedrooms = { $in: bedroomQueries };
      }
    }

    // Bathrooms filter (FIXED: separate $or block in $and)
    if (bathrooms) {
      const bathroomValues = Array.isArray(bathrooms)
        ? bathrooms
        : bathrooms.split(",");

      const bathroomQueries = [];
      let has7Plus = false;

      bathroomValues.forEach((val) => {
        if (val === "7+") {
          has7Plus = true;
        } else {
          const num = Number(val);
          if (!isNaN(num)) bathroomQueries.push(num);
        }
      });

      if (has7Plus && bathroomQueries.length > 0) {
        andConditions.push({
          $or: [
            { bathrooms: { $in: bathroomQueries } },
            { bathrooms: { $gte: 7 } },
          ],
        });
      } else if (has7Plus) {
        query.bathrooms = { $gte: 7 };
      } else if (bathroomQueries.length > 0) {
        query.bathrooms = { $in: bathroomQueries };
      }
    }

    // Add $and conditions only if there are any
    if (andConditions.length > 0) {
      query.$and = andConditions;
    }

    // Amenities filter (ALL must match)
    if (amenities) {
      const amenityList = Array.isArray(amenities)
        ? amenities
        : amenities.split(",");
      query.amenities = { $all: amenityList };
    }

    // Price range
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }

    // Area range
    if (minArea || maxArea) {
      query.area_sqm = {};
      if (minArea) query.area_sqm.$gte = Number(minArea);
      if (maxArea) query.area_sqm.$lte = Number(maxArea);
    }

    // Sorting
    const sortMap = {
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      area_asc: { area_sqm: 1 },
      area_desc: { area_sqm: -1 },
      bedrooms_asc: { bedrooms: 1 },
      bedrooms_desc: { bedrooms: -1 },
    };
    const sortOption = sortMap[sort] || { createdAt: -1 };

    // Pagination
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Execute query
    const [units, totalCount] = await Promise.all([
      Unit.find(query)
        .populate("project", "name location")
        .populate("block", "name")
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum),
      Unit.countDocuments(query),
    ]);

    res.json({
      units,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get filter options (for dropdowns)
router.get("/filters/options", async (req, res) => {
  try {
    const { project } = req.query;
    let matchFilter = {};
    if (project) matchFilter.project = project;

    const [
      propertyTypes,
      projectIds,
      viewTypes,
      amenitiesList,
      finishingTypes,
    ] = await Promise.all([
      Unit.distinct("property_type", matchFilter),
      Unit.distinct("project", matchFilter),
      Unit.distinct("view_type", matchFilter),
      Unit.distinct("amenities", matchFilter),
      Unit.distinct("finishing", matchFilter),
    ]);

    const projects = await Project.find({ _id: { $in: projectIds } }).select(
      "name",
    );

    res.json({
      propertyTypes,
      projects,
      viewTypes: viewTypes.filter(Boolean),
      amenities: amenitiesList.filter(Boolean),
      finishingTypes: finishingTypes.filter(Boolean),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get filter stats (price range, area range, status counts)
router.get("/filters/stats", async (req, res) => {
  try {
    const stats = await Unit.aggregate([
      {
        $facet: {
          priceRange: [
            {
              $group: {
                _id: null,
                min: { $min: "$price" },
                max: { $max: "$price" },
              },
            },
          ],
          areaRange: [
            {
              $group: {
                _id: null,
                min: { $min: "$area_sqm" },
                max: { $max: "$area_sqm" },
              },
            },
          ],
          statusCounts: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          typeCounts: [
            { $group: { _id: "$property_type", count: { $sum: 1 } } },
          ],
          totalUnits: [{ $count: "count" }],
        },
      },
    ]);

    res.json(stats[0]);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single unit with payment calculator
router.get("/:id", async (req, res) => {
  try {
    const unit = await Unit.findById(req.params.id)
      .populate("project")
      .populate("block");

    if (!unit) {
      return res.status(404).json({ message: "Unit not found" });
    }

    // Calculate payment plan from spec
    const downPaymentAmount = unit.price * (unit.down_payment_percentage / 100);
    const remainingAfterDown =
      unit.price - downPaymentAmount - unit.reservation_fee;
    const monthlyPayment = Math.ceil(
      remainingAfterDown / unit.installment_months,
    );

    const paymentPlan = {
      total_price: unit.price,
      reservation_fee: unit.reservation_fee,
      down_payment_percentage: unit.down_payment_percentage,
      down_payment_amount: downPaymentAmount,
      installment_months: unit.installment_months,
      monthly_payment: monthlyPayment,
    };

    res.json({
      ...unit.toObject(),
      payment_plan: paymentPlan,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Payment calculator endpoint (custom inputs from spec Section 3E)
router.get("/:id/calculate", async (req, res) => {
  try {
    const { down_payment_percentage, installment_years } = req.query;

    const unit = await Unit.findById(req.params.id);
    if (!unit) {
      return res.status(404).json({ message: "Unit not found" });
    }

    const dpPercent =
      Number(down_payment_percentage) || unit.down_payment_percentage;
    const months = (Number(installment_years) || 4) * 12;

    const downPaymentAmount = unit.price * (dpPercent / 100);
    const remaining = unit.price - downPaymentAmount - unit.reservation_fee;
    const monthlyPayment = Math.ceil(remaining / months);

    res.json({
      total_price: unit.price,
      reservation_fee: unit.reservation_fee,
      down_payment_percentage: dpPercent,
      down_payment_amount: downPaymentAmount,
      installment_months: months,
      monthly_payment: monthlyPayment,
      remaining_after_down: remaining,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== PROTECTED ROUTES ====================

// Create unit (manager/admin only)
router.post(
  "/",
  authMiddleware,
  authorize("admin", "manager"),
  upload.array("images", 10),
  async (req, res) => {
    try {
      const unitData = { ...req.body };

      // Handle images
      if (req.files && req.files.length > 0) {
        unitData.images = req.files.map((file) => ({
          url: file.path,
          public_id: file.filename,
        }));
      }

      // Parse amenities if string
      if (typeof unitData.amenities === "string") {
        unitData.amenities = JSON.parse(unitData.amenities);
      }

      const unit = new Unit(unitData);
      await unit.save();

      // Log activity
      await ActivityLog.create({
        user: req.userId,
        action: "unit_created",
        details: `Unit ${unit.unit_number} created in project ${unit.project}`,
        target_type: "Unit",
        target_id: unit._id,
      });

      res.status(201).json({ message: "Unit created", unit });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Update unit (manager/admin only)
router.put(
  "/:id",
  authMiddleware,
  authorize("admin", "manager"),
  upload.array("images", 10),
  async (req, res) => {
    try {
      const existingUnit = await Unit.findById(req.params.id);
      if (!existingUnit) {
        return res.status(404).json({ message: "Unit not found" });
      }

      const updates = { ...req.body };

      // Parse amenities if string
      if (typeof updates.amenities === "string") {
        updates.amenities = JSON.parse(updates.amenities);
      }

      // Handle new images (append to existing)
      if (req.files && req.files.length > 0) {
        const newImages = req.files.map((file) => ({
          url: file.path,
          public_id: file.filename,
        }));
        updates.images = [...(existingUnit.images || []), ...newImages];
      }

      const unit = await Unit.findByIdAndUpdate(req.params.id, updates, {
        new: true,
        runValidators: true,
      });

      // Log activity
      await ActivityLog.create({
        user: req.userId,
        action: "unit_updated",
        details: `Unit ${unit.unit_number} updated. Fields: ${Object.keys(updates).join(", ")}`,
        target_type: "Unit",
        target_id: unit._id,
      });

      res.json({ message: "Unit updated", unit });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Delete image from unit (manager/admin only)
router.delete(
  "/:id/images/:publicId",
  authMiddleware,
  authorize("admin", "manager"),
  async (req, res) => {
    try {
      const unit = await Unit.findById(req.params.id);
      if (!unit) {
        return res.status(404).json({ message: "Unit not found" });
      }

      unit.images = unit.images.filter(
        (img) => img.public_id !== req.params.publicId,
      );
      await unit.save();

      // TODO: Also delete from Cloudinary using cloudinary.uploader.destroy(publicId)

      res.json({ message: "Image removed", images: unit.images });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  },
);

// Delete unit (admin only)
router.delete("/:id", authMiddleware, authorize("admin"), async (req, res) => {
  try {
    const unit = await Unit.findById(req.params.id);

    if (!unit) {
      return res.status(404).json({ message: "Unit not found" });
    }

    // Prevent deleting reserved/sold units
    if (["reserved", "sold"].includes(unit.status)) {
      return res.status(400).json({
        message: `Cannot delete a ${unit.status} unit. Cancel reservation first.`,
      });
    }

    await Unit.findByIdAndDelete(req.params.id);

    // Log activity
    await ActivityLog.create({
      user: req.userId,
      action: "unit_deleted",
      details: `Unit ${unit.unit_number} deleted`,
      target_type: "Unit",
      target_id: unit._id,
    });

    res.json({ message: "Unit deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
