import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Project from "../db/models/project.model.js";
import Block from "../db/models/block.model.js";
import Unit from "../db/models/unit.model.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const FORCE = process.argv.includes("--force");

const img = (id) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;

// Pool of distinct, verified real-estate images.
const IMAGES = [
  "1512917774080-9991f1c4c750",
  "1560448204-e02f11c3d0e2",
  "1502672260266-1c1ef2d93688",
  "1493809842364-78817add7ffb",
  "1600585154340-be6161a56a0c",
  "1554995207-c18c203602cb",
  "1564013799919-ab600027ffc6",
  "1570129477492-45c003edd2be",
  "1568605114967-8130f3a36994",
  "1576941089067-2de3c901e126",
  "1580587771525-78b9dba3b914",
  "1599809275671-b5942cabc7a2",
  "1583608205776-bfd35f0d9f83",
  "1605276374104-dee2a0ed3cd6",
  "1512915922686-57c11dde9b6b",
  "1600596542815-ffad4c1539a9",
  "1600607687939-ce8a6c25118c",
  "1600566753086-00f18fb6b3ea",
].map(img);

// Each unit gets a 3-image gallery; lead images are unique across all units.
const galleryFor = (leadIndex) => [
  IMAGES[leadIndex % IMAGES.length],
  IMAGES[(leadIndex + 6) % IMAGES.length],
  IMAGES[(leadIndex + 12) % IMAGES.length],
];

const PROJECTS = [
  {
    name: "K Marassi Residences",
    description:
      "Premium seafront living with resort-style amenities on the North Coast.",
    location_name: "Marassi, North Coast",
    location: {
      coordinates: [28.8, 31.05],
      address: "Marassi, Sidi Abdel Rahman",
      city: "North Coast",
    },
    amenities: ["Pool", "Gym", "Beach Access", "Security", "Clubhouse"],
    images: [IMAGES[0], IMAGES[4]],
  },
  {
    name: "K New Cairo Heights",
    description:
      "Modern apartments and villas in the heart of New Cairo, minutes from the AUC.",
    location_name: "New Cairo, Fifth Settlement",
    location: {
      coordinates: [31.4913, 30.0078],
      address: "South 90th Street, Fifth Settlement",
      city: "New Cairo",
    },
    amenities: ["Gym", "Security", "Kids Area", "Parking", "Retail"],
    images: [IMAGES[6], IMAGES[10]],
  },
];

// Six unit templates per project. `imageOffset` keeps every unit's lead image
// unique across the whole dataset (project 0 -> 0..5, project 1 -> 6..11).
const UNIT_TEMPLATES = [
  {
    unit_number: "A-101",
    price: 3500000,
    area_sqm: 95,
    bedrooms: 2,
    bathrooms: 2,
    floor_number: 1,
    property_type: "Apartment",
    view_type: "garden",
    has_garden: true,
    amenities: ["Pool", "Gym", "Security"],
    description: "Bright 2-bedroom apartment with a private garden view.",
  },
  {
    unit_number: "A-204",
    price: 5200000,
    area_sqm: 140,
    bedrooms: 3,
    bathrooms: 3,
    floor_number: 2,
    property_type: "Apartment",
    view_type: "pool",
    amenities: ["Pool", "Gym", "Security", "Parking"],
    description: "Spacious 3-bedroom apartment overlooking the pool.",
  },
  {
    unit_number: "P-501",
    price: 9800000,
    area_sqm: 220,
    bedrooms: 4,
    bathrooms: 4,
    floor_number: 5,
    property_type: "Penthouse",
    view_type: "sea",
    amenities: ["Pool", "Gym", "Security", "Beach Access", "Parking"],
    description: "Top-floor penthouse with panoramic sea views and terrace.",
  },
  {
    unit_number: "S-010",
    price: 1850000,
    area_sqm: 55,
    bedrooms: 0,
    bathrooms: 1,
    floor_number: 0,
    property_type: "Studio",
    view_type: "street",
    amenities: ["Security", "Parking"],
    description: "Efficient studio, ideal for investment or first home.",
  },
  {
    unit_number: "V-03",
    price: 14500000,
    area_sqm: 320,
    bedrooms: 5,
    bathrooms: 5,
    floor_number: 0,
    property_type: "Villa",
    view_type: "garden",
    has_garden: true,
    amenities: ["Pool", "Gym", "Security", "Clubhouse", "Parking"],
    description: "Standalone villa with private pool and large garden.",
  },
  {
    unit_number: "T-12",
    price: 7300000,
    area_sqm: 185,
    bedrooms: 3,
    bathrooms: 4,
    floor_number: 0,
    property_type: "Townhouse",
    view_type: "park",
    has_garden: true,
    amenities: ["Security", "Kids Area", "Parking"],
    description: "Corner townhouse facing the central park.",
  },
];

const buildUnits = (project, block, imageOffset) =>
  UNIT_TEMPLATES.map((u, i) => ({
    ...u,
    project: project._id,
    block: block._id,
    images: galleryFor(imageOffset + i),
  }));

const seed = async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not defined");
    await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ Connected: ${mongoose.connection.host}`);

    const existing = await Unit.countDocuments();
    if (existing > 0 && !FORCE) {
      console.log(
        `ℹ️  ${existing} unit(s) already exist. Run with --force to wipe sample data and reseed. Exiting.`,
      );
      process.exit(0);
    }

    if (FORCE) {
      await Promise.all([
        Unit.deleteMany({}),
        Block.deleteMany({}),
        Project.deleteMany({}),
      ]);
      console.log("🧹 Cleared existing projects, blocks, and units (--force)");
    }

    let totalUnits = 0;
    for (let idx = 0; idx < PROJECTS.length; idx++) {
      const project = await Project.create(PROJECTS[idx]);
      const block = await Block.create({
        name: "Block A",
        project: project._id,
        total_floors: 8,
        units_per_floor: 4,
        status: "ready",
        description: `Main residential block of ${project.name}.`,
      });
      const units = buildUnits(project, block, idx * UNIT_TEMPLATES.length);
      const created = await Unit.insertMany(units);
      await Project.findByIdAndUpdate(project._id, {
        total_units: created.length,
      });
      totalUnits += created.length;
      console.log(
        `✅ ${project.name}: 1 block, ${created.length} units created`,
      );
    }

    const distinctImages = new Set();
    const allUnits = await Unit.find().select("images");
    allUnits.forEach((u) => u.images.forEach((i) => distinctImages.add(i)));

    console.log(
      `\n🎉 Seed complete: ${PROJECTS.length} projects, ${totalUnits} units, ${distinctImages.size} distinct images.`,
    );
    process.exit(0);
  } catch (error) {
    console.error("❌ Seed error:", error.message);
    process.exit(1);
  }
};

seed();
