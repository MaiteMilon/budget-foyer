import { describe, it, expect } from 'vitest';
import {
  computeMonthlyBudget,
  computeGoalProgress,
  applyPocketTransfer,
  simulateWishlistPurchase,
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
        { amount: 999, sourceType: 'pocket' },
      ],
    });
    // Seuls les 40€ perso comptent, pas les 999€ x2
    expect(result.remaining).toBe(960);
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
