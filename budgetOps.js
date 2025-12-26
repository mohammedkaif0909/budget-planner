import { 
  collection, 
  doc, 
  setDoc, 
  addDoc,
  getDoc, 
  updateDoc, 
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

export async function createBudgetProfile(userId, totalIncome) {
  try {
    await setDoc(doc(db, "budgets", userId), {
      userId: userId,
      totalIncome: totalIncome,
      totalSpent: 0,
      remainingAmount: totalIncome,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    console.log("Budget created");
  } catch (error) {
    console.error("Error:", error);
  }
}

export async function getBudgetProfile(userId) {
  try {
    const docSnap = await getDoc(doc(db, "budgets", userId));
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.error("Error:", error);
  }
}

export async function addTransaction(userId, transactionData) {
  try {
    await addDoc(collection(db, "transactions"), {
      userId: userId,
      amount: transactionData.amount,
      category: transactionData.category,
      description: transactionData.description,
      date: new Date(transactionData.date),
      type: transactionData.type || "expense",
      createdAt: new Date()
    });
    await updateBudgetTotals(userId);
  } catch (error) {
    console.error("Error:", error);
  }
}

export async function getUserTransactions(userId) {
  try {
    const q = query(
      collection(db, "transactions"),
      where("userId", "==", userId),
      orderBy("date", "desc")
    );
    const querySnapshot = await getDocs(q);
    const transactions = [];
    querySnapshot.forEach((doc) => {
      transactions.push({ id: doc.id, ...doc.data() });
    });
    return transactions;
  } catch (error) {
    console.error("Error:", error);
    return [];
  }
}

export async function deleteTransaction(transactionId, userId) {
  try {
    await deleteDoc(doc(db, "transactions", transactionId));
    await updateBudgetTotals(userId);
  } catch (error) {
    console.error("Error:", error);
  }
}

export async function updateBudgetTotals(userId) {
  try {
    const transactions = await getUserTransactions(userId);
    const budget = await getBudgetProfile(userId);
    
    if (!budget) return;
    
    const totalSpent = transactions
      .filter(t => t.type === "expense")
      .reduce((sum, t) => sum + t.amount, 0);
    
    const remainingAmount = budget.totalIncome - totalSpent;
    
    await updateDoc(doc(db, "budgets", userId), {
      totalSpent: totalSpent,
      remainingAmount: remainingAmount,
      updatedAt: new Date()
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

export async function getSpendingSummary(userId) {
  try {
    const transactions = await getUserTransactions(userId);
    const budget = await getBudgetProfile(userId);
    
    const categorySpending = {};
    transactions
      .filter(t => t.type === "expense")
      .forEach(t => {
        categorySpending[t.category] = (categorySpending[t.category] || 0) + t.amount;
      });
    
    return {
      totalIncome: budget?.totalIncome || 0,
      totalSpent: budget?.totalSpent || 0,
      remainingAmount: budget?.remainingAmount || 0,
      categoryBreakdown: categorySpending,
      transactionCount: transactions.length
    };
  } catch (error) {
    console.error("Error:", error);
  }
}