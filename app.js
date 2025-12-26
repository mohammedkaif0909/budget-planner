import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { collection, addDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

new Vue({
  el: '#app-root',
  data: {
    // UI
    sidebarExpanded: false,
    activePage: 'dashboard',

    // Month/year pickers
    months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
    selectedMonth: new Date().getMonth(),
    selectedYear: new Date().getFullYear(),

    // Day & form
    selectedDay: 1,
    userType: "",
    selectedItem: "",
    customItem: "",
    amount: "",
    type: "income",
    incomeMode: "",
    customIncomeMode: "",

    // All months store: in-memory only
    allMonths: {},

    // charts
    summaryChart: null,
    dashboardPie: null,
    monthlyLine: null,
    monthlyPie: null,

    // colors / presets
    colorMap: {
      "Food":"#FF6384","Transport":"#36A2EB","Bills":"#FFCE56","Entertainment":"#8BC34A",
      "Shopping":"#9C27B0","Health":"#4CAF50","Rent":"#FF8C00","Salary":"#2563EB",
      "Freelance":"#6D28D9","Bonus":"#795548","Business Profit":"#00ACC1","Household Budget":"#E91E63","Other":"#64748B"
    },
    colorList:["#FF6384","#36A2EB","#FFCE56","#8BC34A","#9C27B0","#4CAF50","#FF8C00","#2563EB","#6D28D9","#795548","#00ACC1","#E91E63","#64748B"],
    nextColorIndex: 0,

    autoModeByUser: {
      "Student":"Pocket Money","Employee":"Monthly Salary","Businessman":"Business Profit","Housewife":"Household Budget","Freelancer":"Freelance","Other":""
    },

    incomeOptionsByUser: {
      "Student":["Pocket Money","Bonus","Other"],
      "Employee":["Salary","Bonus","Other"],
      "Businessman":["Business Profit","Other"],
      "Housewife":["Household Budget","Other"],
      "Freelancer":["Freelance","Bonus","Other"],
      "Other":["Other"]
    },

    // Goals list (in-memory)
    goals: [],
    goalForm: {
      name: '',
      target: null,
      monthIndex: new Date().getMonth(),
      year: new Date().getFullYear()
    },

    // ===== AI CHAT STATE =====
    aiChatOpen: false,
    aiInput: "",
    aiMessages: [],
    aiLoading: false
  },

  computed: {
    pageTitle() {
      switch(this.activePage){
        case 'dashboard': return 'Dashboard';
        case 'transactions': return 'Transactions';
        case 'reports': return 'Reports';
        case 'goals': return 'Goals';
        case 'settings': return 'Settings';
        default: return 'Budget Planner';
      }
    },

    currentMonthKey(){
      return `bp_month_${this.selectedYear}-${String(this.selectedMonth+1).padStart(2,'0')}`;
    },

    currentMonthData(){
      if(!this.allMonths[this.currentMonthKey]){
        this.$set(this.allMonths, this.currentMonthKey, { days: Array.from({length:30}, ()=>[]), meta:{ createdAt: Date.now() } });
      }
      return this.allMonths[this.currentMonthKey];
    },

    dayItems(){ return this.currentMonthData.days[this.selectedDay - 1] || []; },

    dayTotal(){ return this.dayItems.reduce((s,i)=>s+Number(i.amount||0),0); },

    monthItems() { return this.currentMonthData.days.flat(); },

    monthIncome() { return this.monthItems.filter(i=>i.type==='income').reduce((s,i)=>s+Number(i.amount||0),0); },
    monthExpense() { return this.monthItems.filter(i=>i.type==='expense').reduce((s,i)=>s+Number(i.amount||0),0); },

    monthCategoryTotals() {
      const groups = {};
      this.monthItems.forEach(i=>{
        const name = i.name || 'Other';
        groups[name] = (groups[name] || 0) + Number(i.amount || 0);
      });
      return groups;
    },

    monthTopCategories() {
      const entries = Object.entries(this.monthCategoryTotals);
      entries.sort((a,b)=>b[1]-a[1]);
      return entries.slice(0,6).map(e=>`${e[0]} — ₹ ${e[1]}`);
    },

    monthlyDaysData() {
      const days = Array.from({length:30}, ()=>({ income:0, expense:0 }));
      this.monthItems.forEach(i=>{
        const idx = (typeof i.createdAtDayIndex === 'number') ? i.createdAtDayIndex : 0;
        if(i.isMonthly) {
          if(i.type === 'income') days[0].income += Number(i.amount || 0);
          else days[0].expense += Number(i.amount || 0);
        } else {
          const safeIdx = Math.max(0, Math.min(29, idx));
          if(i.type === 'income') days[safeIdx].income += Number(i.amount || 0);
          else days[safeIdx].expense += Number(i.amount || 0);
        }
      });
      const labels = days.map((_,i)=>`D${i+1}`);
      const incomeData = days.map(d=>d.income);
      const expenseData = days.map(d=>d.expense);
      return { labels, incomeData, expenseData };
    },

    yearRange() { const now=new Date().getFullYear(); const out=[]; for(let y=now-3;y<=now+6;y++) out.push(y); return out; },

    goalsForSelectedMonth() {
      return this.goals.filter(g => g.monthIndex === this.selectedMonth && g.year === this.selectedYear);
    }
  },

  mounted() {
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        window.location.href = './login.html';
      } else {
        // Load data from Firestore when user logs in
        this.loadDataFromFirestore(user.uid);
      }
    });
    this.updateAllCharts();
  },

  methods: {
    // navigation & UI
    go(page){ this.activePage = page; this.$nextTick(()=> this.updateAllCharts()); },
    toggleSidebar(){ this.sidebarExpanded = !this.sidebarExpanded; },
    sidebarHover(on){ if(!this.sidebarExpanded) this.sidebarExpanded = on; },

    onMonthYearChanged() {
      this.loadMonthIfNotExists(this.selectedYear, this.selectedMonth);
      this.updateAllCharts();
    },

    loadMonthIfNotExists(y,m){
      const key = `bp_month_${y}-${String(m+1).padStart(2,'0')}`;
      if(!this.allMonths[key]) {
        this.$set(this.allMonths, key, { days: Array.from({length:30}, ()=>[]), meta:{ createdAt: Date.now() } });
      }
    },

    autoSetMode(){ this.incomeMode = this.autoModeByUser[this.userType]||""; },

    handleItemSelection(){
      if(!this.selectedItem) return;
      if(this.selectedItem in this.itemMapping) {
        const m = this.itemMapping[this.selectedItem];
        this.type = m.type;
        if(m.mode) this.incomeMode = m.mode;
      } else {
        const expenses = ["Food","Transport","Bills","Entertainment","Shopping","Health","Rent"];
        if(expenses.includes(this.selectedItem)) this.type = 'expense';
        else this.type = 'income';
        if(this.selectedItem === 'Salary') this.incomeMode = 'Monthly Salary';
      }
    },

    getNextColor(){ const c = this.colorList[this.nextColorIndex % this.colorList.length]; this.nextColorIndex++; return c; },

    addItem(){
      if(!(this.selectedItem || this.customItem) || !this.amount) {
        alert('Select an item and enter amount');
        return;
      }

      const name = (this.selectedItem === 'Other') ? (this.customItem || 'Other') : (this.selectedItem || this.customItem);
      if(!name) { alert('Enter item name'); return; }

      const checkName = (name||'').toLowerCase();
      const checkMode = (this.incomeMode||'').toLowerCase();
      let isMonthly = false;
      if (checkName.includes('salary') || checkMode.includes('monthly salary') || checkName.includes('rent')) {
        isMonthly = true;
      }

      const createdAtDayIndex = this.selectedDay - 1;

      const newItem = {
        name,
        amount: Number(this.amount),
        type: this.type,
        mode: this.type === 'income' ? (this.incomeMode === 'Other' ? this.customIncomeMode : this.incomeMode) : '',
        color: this.colorMap[name] || this.getNextColor(),
        isMonthly,
        createdAtDayIndex
      };

      this.currentMonthData.days[createdAtDayIndex].push(newItem);

      // SAVE TO FIRESTORE
      const user = auth.currentUser;
      if (user) {
        addDoc(collection(db, 'transactions'), {
          userId: user.uid,
          name: name,
          amount: Number(this.amount),
          category: name,
          description: '',
          date: new Date(),
          type: this.type,
          mode: this.type === 'income' ? (this.incomeMode === 'Other' ? this.customIncomeMode : this.incomeMode) : '',
          isMonthly: isMonthly
        }).then(() => {
          console.log('✅ Transaction saved to Firestore!');
        }).catch((error) => {
          console.error('❌ Error saving to Firestore:', error);
        });
      }

      this.selectedItem=''; this.customItem=''; this.amount=''; this.type='income'; this.incomeMode=''; this.customIncomeMode='';

      this.updateAllCharts();
    },

    updateAllCharts(){
      this.$nextTick(()=>{
        this.updateSummaryChart();
        this.updateDashboardPie();
        this.updateMonthlyCharts();
      });
    },

    updateSummaryChart(){
      const ctxEl = document.getElementById('summaryChart');
      if(!ctxEl) return;
      if(this.summaryChart){ try{ this.summaryChart.destroy(); }catch(e){} this.summaryChart = null; }

      const data = [this.monthIncome, this.monthExpense];
      const labels = ['Income','Expense'];
      const bg = ['#36A2EB','#FF6384'];

      const ctx = ctxEl.getContext('2d');
      this.summaryChart = new Chart(ctx, {
        type:'bar',
        data:{ labels, datasets:[{ label:'Month totals', data, backgroundColor:bg }]},
        options:{ responsive:true, maintainAspectRatio:false }
      });
    },

    updateDashboardPie(){
      const ctxEl = document.getElementById('dashboardPie');
      if(!ctxEl) return;
      if(this.dashboardPie){ try{ this.dashboardPie.destroy(); }catch(e){} this.dashboardPie = null; }

      const groups = this.monthCategoryTotals;
      const labels = Object.keys(groups);
      const data = Object.values(groups);
      const colors = labels.map((lab, i) => this.colorMap[lab] || this.colorList[i % this.colorList.length]);

      const ctx = ctxEl.getContext('2d');
      this.dashboardPie = new Chart(ctx, { type:'pie', data:{ labels, datasets:[{ data, backgroundColor: colors }] }, options:{ responsive:true, maintainAspectRatio:false }});
    },

    updateMonthlyCharts(){
      const { labels, incomeData, expenseData } = this.monthlyDaysData;

      const lineEl = document.getElementById('monthlyLine');
      if(lineEl){
        if(this.monthlyLine){ try{ this.monthlyLine.destroy(); }catch(e){} this.monthlyLine = null; }
        const ctx = lineEl.getContext('2d');
        this.monthlyLine = new Chart(ctx, {
          type:'line',
          data:{
            labels,
            datasets:[
              { label:'Income', data: incomeData, borderColor: 'rgba(37,99,235,0.9)', backgroundColor:'rgba(37,99,235,0.08)', fill:true, tension:0.2, pointRadius:2 },
              { label:'Expense', data: expenseData, borderColor:'rgba(255,99,132,0.9)', backgroundColor:'rgba(255,99,132,0.06)', fill:true, tension:0.2, pointRadius:2 }
            ]
          },
          options:{ responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false}, scales:{ y:{ beginAtZero:true } } }
        });
      }

      const pieEl = document.getElementById('monthlyPie');
      if(pieEl){
        if(this.monthlyPie){ try{ this.monthlyPie.destroy(); }catch(e){} this.monthlyPie = null; }
        const totalIncome = incomeData.reduce((s,n)=>s+n,0);
        const totalExpense = expenseData.reduce((s,n)=>s+n,0);
        const ctx2 = pieEl.getContext('2d');
        this.monthlyPie = new Chart(ctx2, { type:'pie', data:{ labels:['Income','Expense'], datasets:[{ data:[totalIncome,totalExpense], backgroundColor:['#36A2EB','#FF6384'] }] }, options:{ responsive:true, maintainAspectRatio:false } } );
      }
    },

    // UTILITIES
    clearForm(){ this.selectedItem=''; this.customItem=''; this.amount=''; this.type='income'; this.incomeMode=''; this.customIncomeMode=''; this.userType=''; },
    clearDay(){ if(confirm('Clear all entries for this day?')){ this.currentMonthData.days[this.selectedDay -1] = []; this.updateAllCharts(); } },
    clearAll(){ if(confirm('Clear ALL data for all months?')){ this.allMonths = {}; this.goals = []; this.updateAllCharts(); } },

    exportCSV(){
      const rows=[['Name','Amount','Type','Mode','Day','Monthly']];
      this.dayItems.forEach(r=>rows.push([r.name,r.amount,r.type,r.mode||'',this.selectedDay, r.isMonthly ? 'yes' : 'no']));
      const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
      this.downloadBlob(csv, `day-${this.selectedYear}-${String(this.selectedMonth+1).padStart(2,'0')}-d${this.selectedDay}.csv`);
    },

    exportAllCSV(){
      const rows=[['Day','Name','Amount','Type','Mode','Monthly']];
      this.currentMonthData.days.forEach((arr,i)=> arr.forEach(r=>rows.push([i+1,r.name,r.amount,r.type,r.mode||'', r.isMonthly ? 'yes' : 'no']))); 
      const csv = rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
      this.downloadBlob(csv, `month-${this.selectedYear}-${String(this.selectedMonth+1).padStart(2,'0')}.csv`);
    },

    downloadBlob(content, filename){
      const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
    },

    addSample(){
      const sample = [
        { name:'Salary',amount:50000,type:'income', mode:'Monthly Salary', isMonthly:true },
        { name:'Groceries',amount:1200,type:'expense', mode:'', isMonthly:false },
        { name:'Transport',amount:300,type:'expense',mode:'', isMonthly:false },
        { name:'Freelance',amount:8000,type:'income',mode:'Freelance', isMonthly:false },
        { name:'Rent', amount:12000, type:'expense', mode:'', isMonthly:true }
      ];
      const idx = this.selectedDay - 1;
      sample.forEach(s=>{
        this.currentMonthData.days[idx].push(Object.assign({}, s, { color: this.colorMap[s.name] || this.getNextColor(), createdAtDayIndex: idx }));
      });
      this.updateAllCharts();
    },

    genRandomMonth(){
      for(let d=0; d<30; d++){
        this.currentMonthData.days[d] = [];
        const n = Math.floor(Math.random()*4)+1;
        for(let i=0;i<n;i++){
          const isIncome = Math.random()>0.6;
          const name = isIncome ? (Math.random()>0.6 ? 'Freelance' : 'Salary') : ['Food','Transport','Bills','Shopping','Rent'][Math.floor(Math.random()*5)];
          const amt = Math.floor(Math.random()*9000)+100;
          const isMonthly = name.toLowerCase().includes('salary') || (name.toLowerCase().includes('rent') && !isIncome);
          this.currentMonthData.days[d].push({
            name,
            amount: amt,
            type: isIncome ? 'income' : 'expense',
            mode: isIncome ? (name.toLowerCase().includes('salary') ? 'Monthly Salary' : 'Other') : '',
            color: this.colorMap[name] || this.getNextColor(),
            isMonthly,
            createdAtDayIndex: d
          });
        }
      }
      this.updateAllCharts();
    },

    // GOALS
    addGoal(){
      const g = this.goalForm;
      if(!g.name || !g.target){ alert('Fill goal name and target'); return; }
      const id = 'g_' + Math.random().toString(36).substr(2,9);
      this.goals.push({ id, name: g.name, target: Number(g.target), monthIndex: Number(g.monthIndex), year: Number(g.year) });
      this.resetGoalForm();
    },

    resetGoalForm(){ this.goalForm = { name:'', target:null, monthIndex: this.selectedMonth, year: this.selectedYear }; },

    deleteGoal(id){ if(!confirm('Delete this goal?')) return; this.goals = this.goals.filter(g=>g.id!==id); },

    progressAmountForGoal(goal){
      const key = `bp_month_${goal.year}-${String(goal.monthIndex+1).padStart(2,'0')}`;
      const mdata = this.allMonths[key];
      let income = 0, expense = 0;
      if(mdata) {
        mdata.days.forEach(darr=>{
          darr.forEach(it=>{
            if(it.type === 'income') income += Number(it.amount || 0);
            else expense += Number(it.amount || 0);
          });
        });
      } else {
        if(goal.monthIndex === this.selectedMonth && goal.year === this.selectedYear) {
          income = this.monthIncome; expense = this.monthExpense;
        } else {
          income = 0; expense = 0;
        }
      }
      const saved = Math.max(0, income - expense);
      return Math.min(goal.target, Math.round(saved));
    },

    progressPercentForGoal(goal){
      const amt = this.progressAmountForGoal(goal);
      if(!goal.target || goal.target === 0) return 0;
      return Math.max(0, Math.min(100, Math.round((amt / goal.target) * 100)));
    },

    progressColorForGoal(goal){
      const pct = this.progressPercentForGoal(goal);
      if(pct >= 70) return 'linear-gradient(90deg, var(--success), #10b981)';
      if(pct >= 30) return 'linear-gradient(90deg, var(--warning), #f59e0b)';
      return 'linear-gradient(90deg, var(--danger), #ef4444)';
    },

    // ===== AI CHAT METHODS =====
    toggleAIChat() {
      this.aiChatOpen = !this.aiChatOpen;
      this.$nextTick(() => {
        if (this.$refs.chatScroll) {
          this.$refs.chatScroll.scrollTop = this.$refs.chatScroll.scrollHeight;
        }
      });
    },

    clearAIChat() {
      this.aiMessages = [];
    },

    async sendToAI() {
      const userText = (this.aiInput || "").trim();
      if (!userText || this.aiLoading) return;

      // push user message
      this.aiMessages.push({ from: "user", text: userText });
      this.aiInput = "";
      this.aiLoading = true;

      // scroll to bottom
      this.$nextTick(() => {
        if (this.$refs.chatScroll) this.$refs.chatScroll.scrollTop = this.$refs.chatScroll.scrollHeight;
      });

      try {
        const res = await fetch("http://localhost:5678/webhook/ai-budget", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: userText})
        });

        const data = await res.json();
        const answer = data.answer || data.reply || "No reply received.";
        this.aiMessages.push({ from: "ai", text: answer });

      } catch (err) {
        this.aiMessages.push({ from: "ai", text: "Error contacting AI server." });
      } finally {
        this.aiLoading = false;
        this.$nextTick(() => {
          if (this.$refs.chatScroll) this.$refs.chatScroll.scrollTop = this.$refs.chatScroll.scrollHeight;
        });
      }
    },

    // mapping
    itemMapping: {
      "Salary":{type:"income",mode:"Monthly Salary"},
      "Pocket Money":{type:"income",mode:"Pocket Money"},
      "Freelance":{type:"income",mode:"Freelance"},
      "Bonus":{type:"income",mode:"Bonus"},
      "Business Profit":{type:"income",mode:"Business Profit"},
      "Household Budget":{type:"income",mode:"Household Budget"},
      "Food":{type:"expense",mode:""},
      "Transport":{type:"expense",mode:""},
      "Bills":{type:"expense",mode:""},
      "Entertainment":{type:"expense",mode:""},
      "Shopping":{type:"expense",mode:""},
      "Health":{type:"expense",mode:""},
      "Rent":{type:"expense",mode:""}
    },

    // LOAD DATA FROM FIRESTORE
    async loadDataFromFirestore(userId) {
      try {
        const q = query(collection(db, 'transactions'), where('userId', '==', userId));
        const querySnapshot = await getDocs(q);
        
        this.allMonths = {};
        
        querySnapshot.forEach((doc) => {
          const tx = doc.data();
          const date = tx.date.toDate ? tx.date.toDate() : new Date(tx.date);
          const day = date.getDate();
          const monthIdx = date.getMonth();
          const year = date.getFullYear();
          const key = `bp_month_${year}-${String(monthIdx + 1).padStart(2, '0')}`;
          
          if (!this.allMonths[key]) {
            this.$set(this.allMonths, key, { days: Array.from({length:30}, ()=>[]), meta:{ createdAt: Date.now() } });
          }

          const item = {
            name: tx.name,
            amount: tx.amount,
            type: tx.type,
            mode: tx.mode || '',
            color: this.colorMap[tx.name] || this.getNextColor(),
            isMonthly: tx.isMonthly || false,
            createdAtDayIndex: day - 1
          };

          if (day >= 1 && day <= 30) {
            this.allMonths[key].days[day - 1].push(item);
          }
        });
        
        console.log('✅ Data loaded from Firestore!');
        this.updateAllCharts();
      } catch (error) {
        console.error('Error loading from Firestore:', error);
      }
    },

    // LOGOUT
    async logout() {
      if (confirm('Are you sure you want to logout?')) {
        try {
          await signOut(auth);
          window.location.href = './login.html';
        } catch (error) {
          console.error('Error logging out:', error);
        }
      }
    }
  },

  watch: {
    selectedMonth(){ this.updateAllCharts(); },
    selectedYear(){ this.updateAllCharts(); }
  }
});