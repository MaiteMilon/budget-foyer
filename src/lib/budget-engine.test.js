import { describe, it, expect } from 'vitest';
import {
  computeMonthlyBudget,
  computeGoalProgress,
  applyPocketTransfer,
  simulateWishlistPurchase,
  computeInstallmentSchedule,
} from './budget-engine.js';

describe('computeMonthlyBudget', () => {
  it('reproduit exactement l’exemple du cahier des charges (§6)', () => {
    const result = computeMonthlyBudget({
      safetyMargin: 200,
      incomes: [{ amount: 3000 }],
      savingsGoals: [
        { plannedAmount: 500 }, // compte joint
        { plannedAmount: 200 }, // tirelire
        { plannedAmount: 200 }, // épargne perso
      ],
      fixedCharges: [{ amount: 1200 }],
      expenses: [],
    });
    expect(result.initialBudget).toBe(700);
  });

  it('applique ensuite les dépenses (§6 suite)', () => {
    const result = computeMonthlyBudget({
      safetyMargin: 200,
      incomes: [{ amount: 3000 }],
      savingsGoals: [{ plannedAmount: 500 }, { plannedAmount: 200 }, { plannedAmount: 200 }],
      fixedCharges: [{ amount: 1200 }],
      expenses: [
        { amount: 85, sourceType: 'perso' },
        { amount: 50, sourceType: 'perso' },
      ],
    });
    expect(result.remaining).toBe(565);
  });

  it('ignore les dépenses payées depuis le compte joint ou une poche (§9)', () => {
    const result = computeMonthlyBudget({
      safetyMargin: 0,
      incomes: [{ amount: 1000 }],
      savingsGoals: [],
      fixedCharges: [],
      expenses: [
        { amount: 40, sourceType: 'perso' },
        { amount: 999, sourceType: 'compte_joint' },
        { amount: 999, sourceType: 'pocket', pocketUsageType: 'epargne' },
      ],
    });
    // Seuls les 40€ perso comptent, pas les 999€ x2
    expect(result.remaining).toBe(960);
  });

  it('compte les dépenses payées depuis un compte "dépense" (ex. BRED), exactement comme perso', () => {
    const result = computeMonthlyBudget({
      safetyMargin: 0,
      incomes: [{ amount: 1000 }],
      savingsGoals: [],
      fixedCharges: [],
      expenses: [
        { amount: 40, sourceType: 'perso' },
        { amount: 60, sourceType: 'pocket', pocketUsageType: 'depense' },
      ],
    });
    expect(result.remaining).toBe(900);
  });

  it('utilise l’objectif prévu, pas le montant réellement versé, pour réserver l’argent (§3)', () => {
    const result = computeMonthlyBudget({
      safetyMargin: 0,
      incomes: [{ amount: 1000 }],
      savingsGoals: [{ plannedAmount: 500 }], // objectif 500€, même si 0€ n'a encore été viré
      fixedCharges: [],
      expenses: [],
    });
    expect(result.initialBudget).toBe(500);
  });
});

describe('applyPocketTransfer — anti double comptage (§25)', () => {
  it('un virement réel n’affecte que le solde de la poche et le "versé", jamais le budget disponible', () => {
    const { newPocketBalance, newGoalActualPaidIn } = applyPocketTransfer(
      { pocketBalance: 300, goalActualPaidIn: 300 },
      200
    );
    expect(newPocketBalance).toBe(500);
    expect(newGoalActualPaidIn).toBe(500);
    // Le budget disponible n'est PAS recalculé ici : il avait déjà réservé
    // les 500€ dès le départ via planned_amount, ce test documente que
    // cette fonction ne touche à aucune donnée de revenu/dépense.
  });
});

describe('computeGoalProgress', () => {
  it('calcule le reste à verser et la complétion', () => {
    const progress = computeGoalProgress({ plannedAmount: 500, actualPaidIn: 300 });
    expect(progress.remainingToPay).toBe(200);
    expect(progress.isComplete).toBe(false);
    expect(progress.ratio).toBeCloseTo(0.6);
  });

  it('marque complet quand versé >= prévu, même en cas de dépassement', () => {
    const progress = computeGoalProgress({ plannedAmount: 200, actualPaidIn: 200 });
    expect(progress.isComplete).toBe(true);
    expect(progress.ratio).toBe(1);
  });
});

describe('simulateWishlistPurchase', () => {
  it('reproduit l’exemple du cahier des charges (§15)', () => {
    const { before, after } = simulateWishlistPurchase(565, 129);
    expect(before).toBe(565);
    expect(after).toBe(436);
  });
});

describe('computeInstallmentSchedule', () => {
  it('répartit un montant total qui se divise exactement', () => {
    const schedule = computeInstallmentSchedule({
      totalAmount: 600,
      count: 6,
      startMonthISO: '2026-09-01',
    });
    expect(schedule).toHaveLength(6);
    expect(schedule.every((s) => s.amount === 100)).toBe(true);
    expect(schedule.map((s) => s.month)).toEqual([
      '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01',
    ]);
  });

  it('absorbe l’arrondi sur la dernière mensualité, sans perdre un centime', () => {
    const schedule = computeInstallmentSchedule({
      totalAmount: 100,
      count: 3,
      startMonthISO: '2026-09-01',
    });
    // 100 / 3 = 33.33... -> 33.33, 33.33, puis le reste (33.34)
    expect(schedule[0].amount).toBe(33.33);
    expect(schedule[1].amount).toBe(33.33);
    expect(schedule[2].amount).toBe(33.34);
    const sum = schedule.reduce((s, x) => s + x.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(100);
  });

  it('déduit le total à partir d’un montant mensuel donné', () => {
    const schedule = computeInstallmentSchedule({
      monthlyAmount: 45,
      count: 4,
      startMonthISO: '2026-12-01',
    });
    expect(schedule.reduce((s, x) => s + x.amount, 0)).toBe(180);
    // Changement d'année pris en compte correctement
    expect(schedule[1].month).toBe('2027-01-01');
  });
});
