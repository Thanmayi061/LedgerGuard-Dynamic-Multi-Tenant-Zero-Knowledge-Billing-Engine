/**
 * Authentication Service
 *
 * Implements bcrypt password hashing, verification, and asymmetric JWT (RS256)
 * signing and verification using RSA-2048 key pairs.
 */
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { getUserModel } from "../config/db.js";

const SALT_ROUNDS = 10;
const TOKEN_ISSUER = "ledgerguard-api";

// Asymmetric RSA-2048 key management
let privateKey = env.JWT_PRIVATE_KEY;
let publicKey = env.JWT_PUBLIC_KEY;

// If keys are not provided in environment, generate a secure in-memory RSA key pair
if (!privateKey || !publicKey) {
  const pair = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
}

export function getPublicKey() {
  return publicKey;
}

export async function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== "string" || plainPassword.length < 6) {
    throw Object.assign(new Error("Password must be at least 6 characters long."), { statusCode: 400 });
  }
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

export async function comparePassword(plainPassword, hash) {
  if (!plainPassword || !hash) return false;
  return bcrypt.compare(plainPassword, hash);
}

export function generateToken(payload) {
  // Platform admin is strictly restricted to organizationId === "platform"
  const isPlatform = payload.organizationId === "platform";
  const isPlatformAdmin = isPlatform && Boolean(payload.isPlatformAdmin || payload.role === "platform_admin");

  return jwt.sign(
    {
      userId: payload.userId,
      email: payload.email,
      organizationId: payload.organizationId,
      role: isPlatformAdmin ? "platform_admin" : (payload.role || "member"),
      isPlatformAdmin
    },
    privateKey,
    {
      algorithm: "RS256",
      expiresIn: env.JWT_EXPIRES_IN,
      issuer: TOKEN_ISSUER
    }
  );
}

export function generatePlatformAdminToken(secret) {
  const trustedSecret = process.env.PLATFORM_ADMIN_SECRET || "ledgerguard-platform-root-secret-2026";
  if (!secret || secret !== trustedSecret) {
    throw Object.assign(new Error("Invalid platform administrator secret."), { statusCode: 401 });
  }

  return generateToken({
    userId: "platform_root_admin",
    email: "platform-admin@ledgerguard.internal",
    organizationId: "platform",
    role: "platform_admin",
    isPlatformAdmin: true
  });
}

export function verifyToken(token) {
  return jwt.verify(token, publicKey, {
    algorithms: ["RS256"],
    issuer: TOKEN_ISSUER
  });
}

export async function registerUser(tenantDb, { organizationId, name, email, password, role = "member", creatorRole = "admin" }) {
  if (!email || !password || !name) {
    throw Object.assign(new Error("Name, email, and password are required."), { statusCode: 400 });
  }

  const allowedRoles = ["admin", "manager", "member"];
  const targetRole = String(role).trim().toLowerCase();
  if (!allowedRoles.includes(targetRole)) {
    throw Object.assign(new Error(`Invalid role '${role}'. Allowed roles: ${allowedRoles.join(", ")}.`), { statusCode: 400, code: "INVALID_ROLE" });
  }

  // Anti-Privilege Escalation Guard
  if (creatorRole === "manager" && targetRole !== "member") {
    throw Object.assign(new Error("Privilege escalation denied: Managers may only register users with the 'member' role."), { statusCode: 403, code: "ROLE_ESCALATION_DENIED" });
  }
  if (creatorRole === "member") {
    throw Object.assign(new Error("Members are not authorized to register users."), { statusCode: 403, code: "FORBIDDEN" });
  }

  const User = getUserModel(tenantDb);
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await User.findOne({ email: normalizedEmail }).lean();
  if (existing) {
    throw Object.assign(new Error("A user with this email already exists in this organization."), { statusCode: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({
    organizationId,
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role: targetRole,
    isActive: true
  });

  const token = generateToken({
    userId: user._id.toString(),
    email: user.email,
    organizationId: user.organizationId,
    role: user.role,
    isPlatformAdmin: false // Tenant users can NEVER receive platform admin privileges
  });

  return {
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      isActive: user.isActive,
      createdAt: user.createdAt
    },
    token
  };
}

export async function loginUser(tenantDb, { email, password, organizationId }) {
  if (!email || !password) {
    throw Object.assign(new Error("Email and password are required."), { statusCode: 400 });
  }

  const User = getUserModel(tenantDb);
  const normalizedEmail = email.trim().toLowerCase();

  // Explicitly include passwordHash since it is configured with `select: false`
  const user = await User.findOne({ email: normalizedEmail, organizationId }).select("+passwordHash");
  if (!user || !user.isActive) {
    throw Object.assign(new Error("Invalid email or password."), { statusCode: 401 });
  }

  const passwordValid = await comparePassword(password, user.passwordHash);
  if (!passwordValid) {
    throw Object.assign(new Error("Invalid email or password."), { statusCode: 401 });
  }

  const token = generateToken({
    userId: user._id.toString(),
    email: user.email,
    organizationId: user.organizationId,
    role: user.role
  });

  return {
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      isActive: user.isActive
    },
    token
  };
}
