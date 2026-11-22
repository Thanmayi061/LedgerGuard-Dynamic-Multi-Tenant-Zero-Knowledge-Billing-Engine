import mongoose from "mongoose";
const { Schema } = mongoose;

const organizationSchema = new Schema({
  organizationId: { type: String, required: true, unique: true, immutable: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  status: { type: String, enum: ["active","suspended","pending"], default: "pending" },
  plan: { type: String, required: true },
  databaseName: { type: String, required: true, unique: true, match: /^[a-zA-Z0-9_-]+$/ }
}, { timestamps: true, collection: "organizations", versionKey: false });

const userSchema = new Schema({
  organizationId: { type: String, required: true, immutable: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["admin","manager","member"], default: "member", required: true },
  isActive: { type: Boolean, default: true, required: true }
}, { timestamps: true, collection: "users", versionKey: false });
userSchema.index({ email: 1 }, { unique: true });

const idempotencySchema = new Schema({
  status: { type: String, enum: ["in_progress","completed","failed"], default: "in_progress", required: true },
  response: { type: Schema.Types.Mixed, default: null },
  completedAt: { type: Date, default: null }
}, { _id: false });

const billingTransactionSchema = new Schema({
  transactionId: { type: String, required: true, trim: true },
  organizationId: { type: String, required: true, immutable: true },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  status: { type: String, enum: ["pending","success","failed","reversed"], default: "pending", required: true },
  idempotencyKey: { type: String, required: true, trim: true },
  requestHash: { type: String, trim: true, match: /^[a-f0-9]{64}$/i },
  failureReason: { type: String, trim: true, maxlength: 1000, default: null },
  reversedAt: { type: Date, default: null },
  idempotency: { type: idempotencySchema, default: () => ({}) },
  description: { type: String, trim: true },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true, collection: "billingTransactions", versionKey: false });
billingTransactionSchema.index({ transactionId: 1 }, { unique: true });
billingTransactionSchema.index({ idempotencyKey: 1 }, { unique: true });
billingTransactionSchema.index({ status: 1, createdAt: -1 });
billingTransactionSchema.index({ organizationId: 1, createdAt: -1 });

const ledgerEntrySchema = new Schema({
  organizationId: { type: String, required: true, immutable: true },
  transactionRef: { type: Schema.Types.ObjectId, required: true, ref: "BillingTransaction" },
  transactionId: { type: String, required: true },
  journalId: { type: String, required: true },
  accountType: { type: String, enum: ["receivable","revenue","cash"], required: true },
  entryType: { type: String, enum: ["debit","credit"], required: true },
  amountMinor: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  // Set on compensating entries; points to the exact original ledger row.
  reversalOf: { type: Schema.Types.ObjectId, ref: "LedgerEntry", default: null },
  reversalOfJournalId: { type: String, default: null, trim: true },
  reversalOfTransactionRef: { type: Schema.Types.ObjectId, ref: "BillingTransaction", default: null },
  reversalReason: { type: String, trim: true, maxlength: 500, default: null }
}, { timestamps: true, collection: "ledgerEntries", versionKey: false });
ledgerEntrySchema.index({ journalId: 1, createdAt: 1 });
ledgerEntrySchema.index({ transactionRef: 1 });
ledgerEntrySchema.index({ organizationId: 1, createdAt: -1 });

const usageRecordSchema = new Schema({
  organizationId: { type: String, required: true, immutable: true },
  eventId: { type: String, required: true },
  metricType: { type: String, enum: ["api_requests","compute_units","storage"], required: true },
  // Exact quantity = quantityScaled / quantityScale (e.g. 275 / 100 = 2.75).
  quantityScaled: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  quantityScale: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  unit: { type: String, required: true },
  unitPriceMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  totalCostMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  recordedAt: { type: Date, required: true },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true, collection: "usageRecords", versionKey: false });
usageRecordSchema.index({ eventId: 1 }, { unique: true });
usageRecordSchema.index({ metricType: 1, recordedAt: -1 });
usageRecordSchema.index({ organizationId: 1, recordedAt: -1 });

const rateSchema = new Schema({
  metricType: { type: String, enum: ["api_requests","compute_units","storage"], required: true },
  unit: { type: String, required: true },
  unitPriceMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 }
}, { _id: false });

const pricingPlanSchema = new Schema({
  planCode: { type: String, required: true },
  version: { type: Number, required: true, min: 1, validate: Number.isSafeInteger, default: 1 },
  name: { type: String, required: true },
  rates: { type: [rateSchema], required: true, validate: v => v.length > 0 },
  effectiveFrom: { type: Date, required: true },
  effectiveTo: { type: Date, default: null },
  isActive: { type: Boolean, default: true }
}, { timestamps: true, collection: "pricingPlans", versionKey: false });
pricingPlanSchema.index({ planCode: 1, version: 1 }, { unique: true, name: "uniq_plan_version" });
pricingPlanSchema.index({ planCode: 1, effectiveFrom: -1 });
pricingPlanSchema.index({ isActive: 1, effectiveFrom: -1 });

// Periods are half-open: [effectiveFrom, effectiveTo); null effectiveTo means infinity.
// Checks run for document validation and supported query update operations.
pricingPlanSchema.pre("validate", async function validateNoOverlappingPricingPeriods() {
  if (this.effectiveTo && this.effectiveTo <= this.effectiveFrom) {
    this.invalidate("effectiveTo", "effectiveTo must be later than effectiveFrom.");
    return;
  }
  const metricTypes = [...new Set((this.rates || []).map(rate => rate.metricType))];
  for (const metricType of metricTypes) {
    const overlap = await this.constructor.findOne({
      _id: { $ne: this._id },
      planCode: this.planCode,
      rates: { $elemMatch: { metricType } },
      effectiveFrom: { $lt: this.effectiveTo || new Date("9999-12-31T23:59:59.999Z") },
      $or: [ { effectiveTo: null }, { effectiveTo: { $gt: this.effectiveFrom } } ]
    }).select("_id").lean();
    if (overlap) this.invalidate("effectiveFrom", `Pricing period overlaps an existing ${metricType} period for plan ${this.planCode}.`);
  }
});

function applyPricingUpdate(current, update) {
  if (!update || Array.isArray(update)) {
    throw new Error(
      "Aggregation-pipeline pricing updates are not supported; use document save or $set/$unset updates."
    );
  }

  const result = { ...current };
  const operators = Object.keys(update).some(key => key.startsWith("$"));

  if (!operators) return { ...result, ...update };

  for (const [key, values] of Object.entries(update)) {
    if (key === "$set") {
      Object.assign(result, values);
    } else if (key === "$setOnInsert") {
      // Apply only when inserting a new document.
      if (!current) Object.assign(result, values);
    } else if (key === "$unset") {
      for (const field of Object.keys(values)) {
        delete result[field];
      }
    } else if (key === "$inc") {
      for (const [field, amount] of Object.entries(values)) {
        result[field] = (result[field] || 0) + amount;
      }
    } else {
      throw new Error(`Unsupported pricing update operator: ${key}`);
    }
  }

  return result;
}

async function validatePricingQueryUpdate() {
  const update = this.getUpdate();
  const filter = this.getQuery();
  const Model = this.model;
  const current = await Model.findOne(filter).lean();
  if (!current && !this.getOptions().upsert) {
    return;
  }
  const merged = applyPricingUpdate(current || filter, update);
  const candidate = new Model(merged);
  if (current?._id) candidate._id = current._id;
  await candidate.validate();
}

pricingPlanSchema.pre("findOneAndUpdate", validatePricingQueryUpdate);
pricingPlanSchema.pre("updateOne", validatePricingQueryUpdate);
pricingPlanSchema.pre("replaceOne", validatePricingQueryUpdate);
pricingPlanSchema.pre("updateMany", function rejectMultiPricingUpdate() {
  throw new Error("updateMany is disabled for PricingPlan; validate and update one plan at a time.");
});

export const Organization = mongoose.models.Organization || mongoose.model("Organization", organizationSchema);
export const getUserModel = c => c.models.User || c.model("User", userSchema);
export const getBillingTransactionModel = c => c.models.BillingTransaction || c.model("BillingTransaction", billingTransactionSchema);
export const getLedgerEntryModel = c => c.models.LedgerEntry || c.model("LedgerEntry", ledgerEntrySchema);
export const getUsageRecordModel = c => c.models.UsageRecord || c.model("UsageRecord", usageRecordSchema);
export const getPricingPlanModel = c => c.models.PricingPlan || c.model("PricingPlan", pricingPlanSchema);
