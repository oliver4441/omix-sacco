'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Landmark, ShieldCheck, Users, CreditCard, PieChart, Zap, MessageSquare, TrendingUp } from 'lucide-react';
import Link from 'next/link';

const features = [
  { icon: Users, title: 'Member Management', description: 'Digital member registration, KYC verification, and comprehensive member profiles.', color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
  { icon: Landmark, title: 'Savings Tracking', description: 'Track monthly contributions, deposits, withdrawals, and generate statements.', color: 'text-orange-400', bg: 'bg-orange-400/10' },
  { icon: PieChart, title: 'Analytics', description: 'Deep insights into SACCO liquidity, loan risks, and growth trends.', color: 'text-purple-400', bg: 'bg-purple-400/10' },
  { icon: ShieldCheck, title: 'Guarantor System', description: 'Shared approval workflows and automated guarantor records.', color: 'text-green-400', bg: 'bg-green-400/10' },
  { icon: MessageSquare, title: 'WhatsApp Alerts', description: 'Automated alerts and member support via WhatsApp.', color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
  { icon: CreditCard, title: 'M-Pesa Integration', description: 'Native M-Pesa tracking links Paybill transactions to member profiles.', color: 'text-blue-400', bg: 'bg-blue-400/10' },
  { icon: TrendingUp, title: 'Loan Workflows', description: 'Customizable multi-stage loan application and approval pipelines.', color: 'text-pink-400', bg: 'bg-pink-400/10' },
  { icon: Zap, title: 'Enterprise Security', description: 'Role-based access control and secure authentication.', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
];

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-[#0a0f1a]">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0f1a]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Landmark className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-white text-lg">Omix SACCO</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <Link href="/features" className="text-sm text-slate-400 hover:text-white transition-colors">Features</Link>
            <Link href="/pricing" className="text-sm text-slate-400 hover:text-white transition-colors">Pricing</Link>
            <Link href="/about" className="text-sm text-slate-400 hover:text-white transition-colors">About</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-slate-400 hover:text-white transition-colors px-4 py-2">Sign In</Link>
            <Link href="/signup" className="text-sm bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium transition-colors">Get Started</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 dashboard-pattern opacity-20" />
        <div className="absolute top-[-100px] right-[-100px] w-[500px] h-[500px] bg-orange-500/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-100px] left-[-100px] w-[400px] h-[400px] bg-emerald-600/10 blur-[100px] rounded-full pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-4xl mx-auto">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full w-fit mb-8">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest text-emerald-400 font-bold">Modern Fintech Platform</span>
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="text-5xl md:text-7xl font-bold tracking-tight mb-6 text-white">
              SACCO Management<br />Built for <span className="text-gradient-accent">Growth</span>
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="text-lg md:text-xl text-slate-400 mb-10 max-w-2xl mx-auto">
              Manage members, savings, loans, and M-Pesa payments from one intelligent digital platform built for modern SACCOs.
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/signup" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-8 py-4 rounded-xl font-medium transition-all shadow-[0_0_20px_rgba(249,115,22,0.3)]">
                Start Free Trial <ArrowRight className="w-5 h-5" />
              </Link>
              <Link href="/features" className="w-full sm:w-auto flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-8 py-4 rounded-xl font-medium transition-all">
                Explore Features
              </Link>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Everything Your SACCO Needs</h2>
            <p className="text-slate-400 text-lg">Powerful tools to streamline operations, manage members, and drive cooperative growth.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ y: -5 }}
                className="glass-card p-6 group hover:border-white/10 transition-all"
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${feature.bg}`}>
                  <feature.icon className={`w-6 h-6 ${feature.color}`} />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{feature.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="glass-card p-10 md:p-14 rounded-2xl text-center border-orange-500/20 glow-accent relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 rounded-full blur-[80px]" />
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 relative z-10">Ready to Modernize Your SACCO?</h2>
            <p className="text-slate-400 mb-8 max-w-2xl mx-auto relative z-10">Join progressive SACCOs already using Omix to manage thousands of members and millions in assets.</p>
            <Link href="/signup" className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white px-8 py-4 rounded-xl font-medium transition-all shadow-lg shadow-orange-500/20 relative z-10">
              Get Started Free <ArrowRight className="w-5 h-5" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                <Landmark className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm text-slate-400">Omix SACCO</span>
            </div>
            <p className="text-sm text-slate-500">&copy; {new Date().getFullYear()} Omix Systems. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
