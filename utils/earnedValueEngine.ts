import type { Project, Invoice, ProjectSchedule, EarnedValueMetrics } from '@/types';

export function calculateEVM(
  project: Project,
  invoices: Invoice[],
  schedule: ProjectSchedule | null | undefined,
): EarnedValueMetrics {
  console.log('[EVM] Calculating earned value metrics for project:', project.name);

  let bac = 0;
  if (project.linkedEstimate) {
    bac = project.linkedEstimate.grandTotal;
  } else if (project.estimate) {
    bac = project.estimate.grandTotal;
  }

  const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
  const ac = projectInvoices.reduce((sum, inv) => sum + inv.amountPaid, 0);

  let percentComplete = 0;
  if (schedule && schedule.tasks.length > 0) {
    const totalProgress = schedule.tasks.reduce((sum, t) => sum + (t.progress || 0), 0);
    percentComplete = totalProgress / schedule.tasks.length;
  }

  const ev = bac * (percentComplete / 100);

  let elapsedRatio = 0;
  if (project.createdAt && schedule) {
    const startDate = new Date(project.createdAt).getTime();
    const now = Date.now();
    const totalPlannedMs = (schedule.totalDurationDays || 1) * 24 * 60 * 60 * 1000;
    const elapsedMs = now - startDate;
    elapsedRatio = Math.min(elapsedMs / totalPlannedMs, 1);
  }
  const pv = bac * elapsedRatio;

  const sv = ev - pv;
  const cv = ev - ac;
  const spi = pv !== 0 ? ev / pv : 1.0;
  const cpi = ac !== 0 ? ev / ac : 1.0;
  const eac = cpi !== 0 ? bac / cpi : bac;
  const etc = eac - ac;
  const vac = bac - eac;

  const metrics: EarnedValueMetrics = {
    budgetAtCompletion: bac,
    plannedValue: pv,
    earnedValue: ev,
    actualCost: ac,
    scheduleVariance: sv,
    costVariance: cv,
    schedulePerformanceIndex: Math.round(spi * 100) / 100,
    costPerformanceIndex: Math.round(cpi * 100) / 100,
    estimateAtCompletion: Math.round(eac * 100) / 100,
    estimateToComplete: Math.round(etc * 100) / 100,
    varianceAtCompletion: Math.round(vac * 100) / 100,
    percentComplete: Math.round(percentComplete * 10) / 10,
    calculatedAt: new Date().toISOString(),
  };

  console.log('[EVM] Metrics calculated — CPI:', metrics.costPerformanceIndex, 'SPI:', metrics.schedulePerformanceIndex);
  return metrics;
}

export function generateCashFlowData(
  project: Project,
  invoices: Invoice[],
  schedule: ProjectSchedule | null | undefined,
  periods: number = 12,
): { period: string; plannedCumulative: number; actualCumulative: number; forecastCumulative: number }[] {
  const bac = project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;
  const totalDays = schedule?.totalDurationDays ?? 180;
  const daysPerPeriod = Math.ceil(totalDays / periods);
  const startDate = new Date(project.createdAt);

  const projectInvoices = invoices
    .filter(inv => inv.projectId === project.id)
    .sort((a, b) => new Date(a.issueDate).getTime() - new Date(b.issueDate).getTime());

  const data: { period: string; plannedCumulative: number; actualCumulative: number; forecastCumulative: number }[] = [];

  let actualCumulative = 0;
  const metrics = calculateEVM(project, invoices, schedule);
  const cpi = metrics.costPerformanceIndex || 1;

  for (let i = 0; i < periods; i++) {
    const periodStart = new Date(startDate.getTime() + i * daysPerPeriod * 86400000);
    const periodEnd = new Date(startDate.getTime() + (i + 1) * daysPerPeriod * 86400000);

    const plannedRatio = Math.min((i + 1) / periods, 1);
    const plannedCumulative = bac * plannedRatio;

    const periodPayments = projectInvoices.filter(inv => {
      const d = new Date(inv.issueDate).getTime();
      return d >= periodStart.getTime() && d < periodEnd.getTime();
    });
    actualCumulative += periodPayments.reduce((sum, inv) => sum + inv.amountPaid, 0);

    const forecastCumulative = cpi !== 0 ? plannedCumulative / cpi : plannedCumulative;

    data.push({
      period: `Wk ${i + 1}`,
      plannedCumulative: Math.round(plannedCumulative),
      actualCumulative: Math.round(actualCumulative),
      forecastCumulative: Math.round(forecastCumulative),
    });
  }

  return data;
}
