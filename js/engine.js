// MGC pricing engine.
// Pure: no DOM, no imports, no clock, no store reads. Same input -> same output.
// All money is integer centavos. Rounding is half-up (away from zero) to whole centavos,
// applied once at the end of each ladder step.
//
// Order of operations: (acq + hauling) + margin + premiums − discounts + buffer, then VAT.

function roundC(x) {
  const v = Number(Number(x).toFixed(6));
  return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
}

function peso(c) {
  const abs = Math.abs(c);
  return `₱${Math.floor(abs / 100).toLocaleString('en-PH')}.${String(abs % 100).padStart(2, '0')}`;
}

// Default floor: acq + hauling + margin. Net of premiums, discounts and buffer.
export function defaultFloorPerKg(costBasis, marginPerKg) {
  return roundC(costBasis.acqPerKg) + roundC(costBasis.haulingPerKg) + roundC(marginPerKg);
}

// Derived premium components. Returns centavos per kg, or null when inputs are missing.
export function derivePremiumPerKg(component, account) {
  if (component.type !== 'derived') return component.perKg ?? null;
  const trmv = account && account.trmvKg;
  if (!trmv) return null;
  if (component.code === 'ROI_INSTALL') {
    if (account.investmentCentavos == null) return null;
    return roundC(account.investmentCentavos / trmv);
  }
  if (component.code === 'ENTRUSTED_CYL') {
    if (account.entrustedCylCount == null || account.cylCostCentavos == null) return null;
    return roundC((account.entrustedCylCount * account.cylCostCentavos) / trmv);
  }
  return null;
}

export function resolvePrice(input) {
  const {
    costBasis,
    sku,
    marginPerKg,
    bufferPerKg = 0,
    premiums = [],
    discounts = [],
    quantity = 1,
    vatRate = 0,
    vatInclusive = true,
    floorPerKg = null,
  } = input;

  const ladder = [];
  const warnings = [];
  let running = 0;

  const step = (label, perKg, kind, code) => {
    const v = roundC(perKg || 0);
    running += v;
    ladder.push({ step: label, perKg: v, runningPerKg: running, kind, code: code || null });
  };

  step('Acquisition cost', costBasis.acqPerKg, 'cost');
  step('Hauling', costBasis.haulingPerKg, 'cost');
  step('Margin', marginPerKg, 'margin');
  for (const p of premiums) step(p.label, Math.abs(p.perKg), 'premium', p.code);
  for (const d of discounts) step(d.label, -Math.abs(d.perKg), 'discount', d.code);
  step('Buffer', bufferPerKg, 'buffer');

  const netPerKg = running;
  const netPerCyl = roundC(netPerKg * sku.contentKg);
  const vatPerCyl = vatInclusive ? roundC(netPerCyl * vatRate) : 0;
  const grossPerCyl = netPerCyl + vatPerCyl;
  const qty = Math.max(0, Math.floor(quantity || 0));
  const grossTotal = grossPerCyl * qty;

  const floor = floorPerKg == null ? defaultFloorPerKg(costBasis, marginPerKg) : roundC(floorPerKg);
  const marginVsFloorPerKg = netPerKg - floor;
  const belowFloor = marginVsFloorPerKg < 0;

  if (belowFloor) warnings.push(`Final price is ${peso(-marginVsFloorPerKg)}/kg below floor`);
  if (qty === 0) warnings.push('Quantity is zero');

  return {
    ladder,
    netPerKg,
    netPerCyl,
    vatPerCyl,
    grossPerCyl,
    grossTotal,
    quantity: qty,
    floorPerKg: floor,
    marginVsFloorPerKg,
    belowFloor,
    warnings,
  };
}
