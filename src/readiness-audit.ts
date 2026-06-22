import { buildReadinessReport, formatReadinessReport } from "./readiness";

const report = buildReadinessReport();
console.log(formatReadinessReport(report));
if (!report.ok) process.exit(1);
