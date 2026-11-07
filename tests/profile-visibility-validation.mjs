import assert from "node:assert/strict";
import mongoose from "mongoose";
import { canShowCompanyInfo, canShowProfileEmail, canViewProfile } from "../lib/profile-visibility.ts";
import EmployerProfile from "../models/EmployerProfile.ts";
import UserPreference from "../models/UserPreference.ts";

assert.equal(canViewProfile({ profileVisibility: "public" }, false, false, false), true);
assert.equal(canViewProfile({ profileVisibility: "private" }, false, false, false), false);
assert.equal(canViewProfile({ profileVisibility: "private" }, false, false, true), true);
assert.equal(canViewProfile({ profileVisibility: "private" }, true, false, false), true);
assert.equal(canViewProfile({ profileVisibility: "private" }, false, true, false), true);
assert.equal(canShowProfileEmail({ profileVisibility: "public", emailVisibility: true }), true);
assert.equal(canShowProfileEmail({ profileVisibility: "public" }), false);
assert.equal(canShowProfileEmail({ profileVisibility: "private", emailVisibility: true }), false);
assert.equal(canShowCompanyInfo({ companyInfoVisibility: false }), false);
assert.equal(canShowCompanyInfo({}), true);

const preferences = new UserPreference({ user: new mongoose.Types.ObjectId() });
await preferences.validate();
assert.equal(preferences.emailVisibility, false);
assert.equal(preferences.companyInfoVisibility, true);
assert.ok(EmployerProfile.schema.path("companyDescription"));

console.log("Profile visibility validation passed: public/private access, relationship exceptions, and contact/company visibility defaults.");
