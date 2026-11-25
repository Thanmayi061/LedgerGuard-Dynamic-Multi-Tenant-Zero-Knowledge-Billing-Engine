import readline from "node:readline";

await import("../src/config/env.js");

const { createOrganization } = await import("../src/services/tenant.service.js");
const {
  getPlatformConnection,
  getTenantConnection,
  getUserModel,
  Organization
} = await import("../src/config/db.js");
const { hashPassword } = await import("../src/services/auth.service.js");

const ORG_ID = "org_abhishek_test";
const DB_NAME = "lg_tenant_abhishek";
const EMAIL = "admin@test.ledgerguard.local";

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(question);

    let password = "";
    const wasRaw = stdin.isRaw;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const finish = value => {
      stdin.setRawMode(wasRaw || false);
      stdin.pause();
      stdin.removeListener("data", onData);
      stdout.write("\n");
      resolve(value);
    };

    const onData = key => {
      if (key === "\u0003") {
        stdin.setRawMode(wasRaw || false);
        process.exit(130);
      }
      if (key === "\r" || key === "\n") {
        finish(password);
      } else if (key === "\u007f" || key === "\b") {
        password = password.slice(0, -1);
      } else if (key >= " ") {
        password += key;
      }
    };

    stdin.on("data", onData);
  });
}

let platform;
let tenant;

try {
  const password = await askHidden("Choose a test admin password (minimum 6 characters): ");
  if (password.length < 6) {
    throw new Error("Password must contain at least 6 characters.");
  }

  platform = await getPlatformConnection();
  const Org = platform.models.Organization ||
    platform.model("Organization", Organization.schema);

  let organization = await Org.findOne({ organizationId: ORG_ID }).lean();

  if (organization) {
    if (organization.databaseName !== DB_NAME || organization.status !== "active") {
      throw new Error("Existing test organization has an unexpected database mapping or status. No changes made.");
    }
    console.log("Test organization already exists; reusing it.");
  } else {
    organization = await createOrganization({
      organizationId: ORG_ID,
      name: "LedgerGuard Test Org",
      email: EMAIL,
      plan: "starter",
      databaseName: DB_NAME
    });
    console.log("Test organization created.");
  }

  tenant = await getTenantConnection(ORG_ID);
  const User = getUserModel(tenant);

  let user = await User.findOne({ email: EMAIL }).lean();

  if (user) {
    console.log("Test admin already exists; password was not changed.");
  } else {
    const passwordHash = await hashPassword(password);
    user = await User.create({
      organizationId: ORG_ID,
      name: "LedgerGuard Test Admin",
      email: EMAIL,
      passwordHash,
      role: "admin",
      isActive: true
    });
    console.log("Test admin user created.");
  }

  console.log("\nSetup completed.");
  console.log("Organization ID:", ORG_ID);
  console.log("Tenant database:", DB_NAME);
  console.log("Admin email:", EMAIL);
  console.log("Password: kept private");
} catch (error) {
  console.error("\nSetup failed:", error.message);
  process.exitCode = 1;
} finally {
  const { closeDatabaseConnections } = await import("../src/config/db.js");
  await closeDatabaseConnections();
}
