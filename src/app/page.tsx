'use client';

import { motion, useInView, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import Link from 'next/link';
import {
  ShieldCheck, Eye, Lock, ArrowUpRight, Layers,
  Database, KeyRound, Zap, ExternalLink, GitCommit,
  ChevronRight, CircleDot,
} from 'lucide-react';

// ── On-chain constants (testnet) ──────────────────────────────────────────────
const PACKAGE_ID    = '0xc5438e8e1744fc064cab7a69d53d80a25bb78ff4c2a6a8507ccb84457616b3fb';
const DELEGATION_ID = '0x02db73fb54a43973bdb2b216d0684e61ce14e02727f48e43fa09552d4d01eb5f';
const SEAL_PKG      = '0x4016869413374eaa71df2a043d1660ed7bc927ab7962831f8b07efbc7efdb2c3';
const EXPLORER      = 'https://suiscan.xyz/testnet';

function short(s: string, n = 10) {
  return `${s.slice(0, n)}…${s.slice(-6)}`;
}

// ── Animation helpers ─────────────────────────────────────────────────────────

const ease = [0.16, 1, 0.3, 1] as const;

function FadeUp({
  children, delay = 0, className = '',
}: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 28 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.75, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Logo: P with bezier node handles (option O from reference) ────────────────
function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none" aria-hidden="true">
      {/* Stem */}
      <line x1="7" y1="5" x2="7" y2="25" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
      {/* Bowl */}
      <path
        d="M7 5 C7 5 21 5 21 13 C21 21 7 21 7 21"
        stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none"
      />
      {/* Node dots */}
      <circle cx="7"  cy="5"  r="2.4" fill="#818cf8" />
      <circle cx="21" cy="13" r="2.4" fill="#818cf8" />
      <circle cx="7"  cy="21" r="2.4" fill="#818cf8" />
      {/* Bezier handles */}
      <line x1="7"  y1="5"  x2="14"   y2="3.2" stroke="#818cf8" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
      <line x1="21" y1="13" x2="24.5" y2="7.5" stroke="#818cf8" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
      <line x1="21" y1="13" x2="24.5" y2="18.5" stroke="#818cf8" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

// ── Background ────────────────────────────────────────────────────────────────
function Background() {
  const { scrollYProgress } = useScroll();
  const y1 = useTransform(scrollYProgress, [0, 1], ['0%', '30%']);
  const y2 = useTransform(scrollYProgress, [0, 1], ['0%', '-20%']);
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-[#05050a]" />
      {/* Parallax glow blobs */}
      <motion.div
        style={{ y: y1 }}
        className="absolute -top-40 left-1/4 w-[700px] h-[500px] rounded-full"
        aria-hidden
      >
        <div className="w-full h-full bg-indigo-600/[0.12] rounded-full blur-[140px]" />
      </motion.div>
      <motion.div
        style={{ y: y2 }}
        className="absolute top-1/2 -right-32 w-[500px] h-[500px] rounded-full"
        aria-hidden
      >
        <div className="w-full h-full bg-violet-700/[0.08] rounded-full blur-[120px]" />
      </motion.div>
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px]" aria-hidden>
        <div className="w-full h-full bg-indigo-800/[0.07] rounded-full blur-[100px]" />
      </div>
      {/* Subtle dot grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
    </div>
  );
}

// ── Glass card ────────────────────────────────────────────────────────────────
function GlassCard({
  children, className = '', hover = true,
}: { children: React.ReactNode; className?: string; hover?: boolean }) {
  return (
    <motion.div
      whileHover={hover ? { y: -4, scale: 1.01 } : undefined}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`glass rounded-2xl glow-border ${className}`}
    >
      {children}
    </motion.div>
  );
}

// ── Step card ─────────────────────────────────────────────────────────────────
function StepCard({
  n, title, sub, detail, delay,
}: { n: string; title: string; sub: string; detail: string; delay: number }) {
  return (
    <FadeUp delay={delay}>
      <GlassCard className="p-6 h-full flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-indigo-400">{n}</span>
          </div>
          <h3 className="text-base font-semibold text-zinc-50">{title}</h3>
        </div>
        <p className="text-sm text-zinc-400 leading-relaxed flex-1">{sub}</p>
        <p className="text-[11px] font-mono text-zinc-600 leading-relaxed border-l-2 border-zinc-800 pl-3">
          {detail}
        </p>
      </GlassCard>
    </FadeUp>
  );
}

// ── Stack card ────────────────────────────────────────────────────────────────
function StackCard({
  icon: Icon, name, role, href, badge,
}: { icon: React.ElementType; name: string; role: string; href: string; badge?: string }) {
  return (
    <FadeUp>
      <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full">
        <GlassCard className="p-5 h-full flex flex-col gap-3 cursor-pointer">
          <div className="flex items-start justify-between gap-2">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/15 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <Icon size={18} className="text-indigo-400" />
            </div>
            {badge && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-900/60 text-zinc-500">
                {badge}
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-zinc-50">{name}</span>
              <ExternalLink size={11} className="text-zinc-600" />
            </div>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{role}</p>
          </div>
        </GlassCard>
      </a>
    </FadeUp>
  );
}

// ── Feature card ──────────────────────────────────────────────────────────────
function FeatureCard({
  icon: Icon, title, body, delay,
}: { icon: React.ElementType; title: string; body: string; delay: number }) {
  return (
    <FadeUp delay={delay}>
      <GlassCard className="p-6 flex flex-col gap-4 h-full">
        <div className="w-11 h-11 rounded-2xl bg-indigo-600/15 border border-indigo-500/25 flex items-center justify-center">
          <Icon size={20} className="text-indigo-400" />
        </div>
        <div>
          <h3 className="font-semibold text-zinc-100 mb-2">{title}</h3>
          <p className="text-sm text-zinc-500 leading-relaxed">{body}</p>
        </div>
      </GlassCard>
    </FadeUp>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: string }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-400">
      {children}
    </p>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen text-zinc-50" style={{ overflowX: 'clip' }}>
      <Background />

      {/* ── Hero — Fluxio-style card with inner nav + arc orbs ────────────── */}
      <section className="min-h-screen p-3 sm:p-4 flex flex-col">
        {/* Outer rounded card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease }}
          className="relative flex-1 rounded-[24px] overflow-hidden flex flex-col"
          style={{ background: '#080810', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          {/* ── Inner nav ───────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease }}
            className="relative z-20 flex items-center justify-between px-6 py-5"
          >
            <Link href="/" className="flex items-center gap-2.5">
              <LogoMark size={26} />
              <span className="font-semibold text-zinc-50 tracking-tight">Provenant</span>
            </Link>

            {/* Centre links */}
            <div className="hidden md:flex items-center gap-6 text-sm text-zinc-500">
              <Link href="#how-it-works" className="hover:text-zinc-200 transition-colors">How it works</Link>
              <Link href="#demo" className="hover:text-zinc-200 transition-colors">Demo</Link>
              <a href={`${EXPLORER}/object/${PACKAGE_ID}`} target="_blank" rel="noopener noreferrer"
                className="hover:text-zinc-200 transition-colors">Contract</a>
            </div>

            <Link href="/inspector">
              <motion.span
                whileHover={{ scale: 1.04, boxShadow: '0 0 24px -4px rgba(99,102,241,0.7)' }}
                whileTap={{ scale: 0.97 }}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-lg shadow-indigo-900/40"
              >
                Inspector
                <ArrowUpRight size={14} />
              </motion.span>
            </Link>
          </motion.div>

          {/* ── Content ─────────────────────────────────────────────────── */}
          <div className="relative z-10 flex flex-col items-center justify-center text-center flex-1 px-6 pb-10 pt-4">

            {/* Live badge — avatar-stack style like Fluxio */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3, ease }}
              className="mb-5 sm:mb-8 flex items-center gap-2.5 text-xs text-zinc-400"
            >
              <div className="flex -space-x-1.5">
                {['#6366f1', '#818cf8', '#a5b4fc'].map((c, i) => (
                  <div key={i} className="w-5 h-5 rounded-full border border-[#080810] flex items-center justify-center"
                    style={{ background: c }}>
                    <CircleDot size={8} className="text-white/70" />
                  </div>
                ))}
              </div>
              <span>Live on Sui Testnet · 1 USDC settled</span>
            </motion.div>

            {/* Headline — two tight lines like Fluxio */}
            <div className="max-w-3xl mx-auto mb-4 sm:mb-6">
              {[
                { text: 'Proof-gated escrow.', accent: false },
                { text: 'Agents prove every decision.', accent: true },
              ].map(({ text, accent }, i) => (
                <motion.h1
                  key={text}
                  className={`block text-3xl sm:text-6xl lg:text-7xl font-bold leading-tight tracking-tight ${
                    accent ? 'text-indigo-400' : 'text-zinc-50'
                  }`}
                  initial={{ opacity: 0, y: 28, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.65, delay: 0.35 + i * 0.12, ease }}
                >
                  {text}
                </motion.h1>
              ))}
            </div>

            {/* Sub */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.62, ease }}
              className="text-sm sm:text-base text-zinc-500 max-w-sm mx-auto leading-relaxed mb-5 sm:mb-8"
            >
              Every decision is encrypted, stored on Walrus, and committed on-chain.
              Settlement only unlocks when the trail checks out.
            </motion.p>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.75, ease }}
              className="flex items-center gap-3"
            >
              <Link href="/inspector">
                <motion.span
                  whileHover={{ scale: 1.04, boxShadow: '0 0 32px -4px rgba(99,102,241,0.7)' }}
                  whileTap={{ scale: 0.97 }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 sm:px-6 sm:py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs sm:text-sm transition-colors shadow-xl shadow-indigo-900/40"
                >
                  Open Inspector
                  <ArrowUpRight size={15} />
                </motion.span>
              </Link>
              <a href={`${EXPLORER}/object/${PACKAGE_ID}`} target="_blank" rel="noopener noreferrer">
                <motion.span
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 sm:px-5 sm:py-3 rounded-xl text-zinc-300 font-medium text-xs sm:text-sm transition-all"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  View Contract
                  <ExternalLink size={13} className="opacity-60" />
                </motion.span>
              </a>
            </motion.div>
          </div>{/* /content */}

          {/* ── Concentric arc orbs (Fluxio-style, indigo palette) ────────── */}
          <div className="relative flex-shrink-0 z-0 h-[220px] sm:h-[420px] -mt-[160px] sm:-mt-[320px]">
            {/* Fade from card bg into arcs */}
            <div className="absolute inset-x-0 top-0 h-28 sm:h-64 pointer-events-none z-10"
              style={{ background: 'linear-gradient(to bottom, #080810 40%, transparent)' }} />

            {/* Rings — outermost → innermost, each a clipped ellipse */}
            {[
              { w: '143%', h: '560px', bot: '-390px', bg: 'rgba(28,25,72,0.68)',   bdr: 'rgba(55,48,163,0.15)' },
              { w: '119%', h: '510px', bot: '-365px', bg: 'rgba(46,42,122,0.63)',  bdr: 'rgba(79,70,229,0.22)' },
              { w: '97%',  h: '460px', bot: '-340px', bg: 'rgba(64,54,194,0.56)',  bdr: 'rgba(99,102,241,0.31)' },
              { w: '77%',  h: '415px', bot: '-318px', bg: 'rgba(85,72,215,0.50)',  bdr: 'rgba(129,140,248,0.38)' },
              { w: '59%',  h: '370px', bot: '-298px', bg: 'rgba(106,90,228,0.47)', bdr: 'rgba(165,180,252,0.45)' },
              { w: '42%',  h: '325px', bot: '-278px', bg: 'rgba(126,120,238,0.45)',bdr: 'rgba(199,210,254,0.52)' },
              { w: '26%',  h: '280px', bot: '-260px', bg: 'rgba(160,160,245,0.48)',bdr: 'rgba(224,231,255,0.60)' },
            ].map((ring, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1.2, delay: 0.45 + i * 0.07, ease }}
                className="absolute left-1/2 -translate-x-1/2 rounded-full"
                style={{
                  width: ring.w, height: ring.h, bottom: ring.bot,
                  background: `radial-gradient(ellipse at 50% 36%, ${ring.bg}, transparent 70%)`,
                  border: `1px solid ${ring.bdr}`,
                  boxShadow: i >= 5 ? `0 0 80px -12px ${ring.bdr}` : 'none',
                }}
              />
            ))}

            {/* Address chips — positioned below the CTA overlap zone */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.85, ease }}
              className="absolute inset-x-0 flex justify-center gap-2 z-20 top-[148px] sm:top-[300px]"
            >
              {[
                { label: 'pkg',  value: short(PACKAGE_ID, 8) },
                { label: 'seal', value: short(SEAL_PKG, 8) },
                { label: 'net',  value: 'testnet' },
              ].map(({ label, value }) => (
                <span key={label}
                  className="inline-flex items-center gap-1.5 text-[10px] font-mono px-3 py-1.5 rounded-full text-zinc-500"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <span className="text-zinc-700">{label}</span> {value}
                </span>
              ))}
            </motion.div>
          </div>{/* /arcs */}

        </motion.div>{/* /card */}
      </section>

      {/* ── THE PROBLEM ───────────────────────────────────────────────────── */}
      <section className="py-12 sm:py-24 px-6 max-w-6xl mx-auto">
        <FadeUp className="mb-8 sm:mb-14 space-y-4 max-w-3xl">
          <SectionLabel>The problem</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-50 leading-tight">
            AI agents are getting real budgets.<br className="hidden sm:block" /> The accountability hasn&apos;t caught up.
          </h2>
        </FadeUp>

        <div className="max-w-3xl space-y-6">
          {[
            'DAOs are paying agents to manage treasury. Protocols are using agents to execute trades. Teams are automating financial decisions worth thousands of dollars.',
            'When something goes wrong — a bad trade, a missed action, an unauthorized call — all you have is the agent\'s own logs. The agent is the only witness to its own behavior.',
            'Screenshots and self-reported logs are fragile and gameable. There is no cryptographic proof that the agent did what it claims.',
          ].map((para, i) => (
            <FadeUp key={i} delay={i * 0.1}>
              <p className={`text-base leading-relaxed ${i === 1 ? 'text-zinc-300' : 'text-zinc-500'}`}>
                {para}
              </p>
            </FadeUp>
          ))}
        </div>
      </section>

      {/* ── WITHOUT vs WITH ───────────────────────────────────────────────── */}
      <section className="py-12 sm:py-24 px-6 max-w-6xl mx-auto">
        <FadeUp className="text-center mb-8 sm:mb-14 space-y-3">
          <SectionLabel>The trust gap</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-50">Without Provenant vs With Provenant</h2>
        </FadeUp>

        <FadeUp>
          <div className="grid sm:grid-cols-2 gap-px rounded-2xl overflow-hidden"
            style={{ border: '1px solid rgba(255,255,255,0.07)' }}>

            {/* Left — Without */}
            <div className="bg-zinc-950/80 p-8 sm:p-10">
              <p className="text-sm font-semibold text-zinc-600 uppercase tracking-widest mb-8">Without Provenant</p>
              <ul className="space-y-5">
                {[
                  'Agent executes task',
                  'Returns a log file',
                  'You hope the reasoning was sound',
                  'You pay or dispute manually',
                  'No on-chain record',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-zinc-500">
                    <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-red-950/50 border border-red-900/50 flex items-center justify-center text-[11px] font-bold text-red-500">✗</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right — With */}
            <div className="p-8 sm:p-10" style={{ background: 'rgba(49,46,129,0.15)' }}>
              <p className="text-sm font-semibold text-indigo-400 uppercase tracking-widest mb-8">With Provenant</p>
              <ul className="space-y-5">
                {[
                  'Agent commits every decision on-chain before acting',
                  'Each node is encrypted and stored on Walrus',
                  'You inspect the proof and decrypt any node',
                  'Escrow releases only when the trail verifies',
                  'Permanent, tamper-evident record',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-zinc-300">
                    <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-green-950/60 border border-green-800/60 flex items-center justify-center text-[11px] font-bold text-green-400">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </FadeUp>
      </section>

      {/* ── REAL SCENARIO ─────────────────────────────────────────────────── */}
      <section className="py-12 sm:py-24 px-6 max-w-6xl mx-auto">
        <FadeUp className="mb-8 sm:mb-14 space-y-3">
          <SectionLabel>What it looks like in practice</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-50">A real delegation. A real proof trail.</h2>
        </FadeUp>

        <FadeUp delay={0.1}>
          <GlassCard className="p-8 sm:p-10" hover={false}>
            <p className="text-base text-zinc-400 leading-relaxed max-w-3xl">
              An agent was delegated a treasury analysis task with{' '}
              <span className="text-zinc-200 font-medium">1 USDC held in escrow</span>. It read the portfolio
              via Tatum MCP, analyzed the composition{' '}
              <span className="text-zinc-200 font-medium">(13% SUI / 87% USDC)</span>, and recommended buying
              SUI to reach a 30/70 target. Every step was committed as an encrypted decision node on Walrus
              before the agent moved to the next action. The principal opened the Inspector, decrypted each
              node privately, verified every commitment hash matched its blob, and approved. The escrow
              released.
            </p>
            <p className="mt-6 text-base text-zinc-200 font-medium">
              The agent got paid because it could prove how it decided.
            </p>
            <div className="mt-8">
              <Link href="/inspector">
                <motion.span
                  whileHover={{ scale: 1.03, boxShadow: '0 0 28px -4px rgba(99,102,241,0.6)' }}
                  whileTap={{ scale: 0.97 }}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors shadow-lg shadow-indigo-900/30"
                >
                  See the live proof trail
                  <ArrowUpRight size={15} />
                </motion.span>
              </Link>
            </div>
          </GlassCard>
        </FadeUp>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-12 sm:py-24 px-6 max-w-6xl mx-auto">
        <FadeUp className="text-center mb-8 sm:mb-14 space-y-3">
          <SectionLabel>How it works</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-50">Three steps. One proof.</h2>
        </FadeUp>

        <div className="grid sm:grid-cols-3 gap-5">
          <StepCard
            n="01" delay={0}
            title="Fund"
            sub="Principal creates a Delegation, locks USDC in a shared Sui escrow object with a deadline and acceptance criteria."
            detail="create_and_fund<USDC>(payment, task_spec, criteria_hash, deadline_ms)"
          />
          <StepCard
            n="02" delay={0.1}
            title="Agent Proves"
            sub="AI agent performs the task. Every decision is Seal-encrypted, stored as a Walrus blob, and keccak256-committed on-chain."
            detail="append_node(blob_id, encryption_id, keccak256(payload), public_meta)"
          />
          <StepCard
            n="03" delay={0.2}
            title="Settle"
            sub="Principal verifies every commitment matches its blob, inspects private reasoning through Seal, approves — escrow releases."
            detail="verify_and_settle → commitment check → Seal decrypt → USDC released"
          />
        </div>

        {/* Status flow */}
        <FadeUp delay={0.3} className="mt-8">
          <div className="flex items-center justify-center flex-wrap gap-2 text-[11px] font-mono">
            {['FUNDED', 'CLAIMED', 'SUBMITTED'].map((s) => (
              <span key={s} className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg glass text-zinc-500">{s}</span>
                <ChevronRight size={12} className="text-zinc-700" />
              </span>
            ))}
            <span className="px-2.5 py-1 rounded-lg bg-green-950/40 border border-green-800/50 text-green-400">
              SETTLED
            </span>
          </div>
        </FadeUp>
      </section>

      {/* ── Live demo ─────────────────────────────────────────────────────── */}
      <section id="demo" className="py-12 sm:py-24 px-6 max-w-6xl mx-auto">
        <FadeUp className="text-center mb-8 sm:mb-14 space-y-3">
          <SectionLabel>Live demo</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-50">Real delegation. Real USDC. Settled.</h2>
        </FadeUp>

        <FadeUp>
          <GlassCard className="overflow-hidden" hover={false}>
            {/* Header bar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                </div>
                <span className="text-sm font-semibold text-zinc-200 ml-1">Treasury Analysis</span>
                <span className="text-[11px] font-mono text-zinc-600">treasury_analysis_v1</span>
              </div>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full border border-green-700/60 bg-green-950/30 text-green-400">
                Settled
              </span>
            </div>

            {/* Body grid */}
            <div className="grid sm:grid-cols-3 gap-8 p-6">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-3">Delegation object</p>
                <a
                  href={`${EXPLORER}/object/${DELEGATION_ID}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs font-mono text-indigo-400 hover:text-indigo-300 break-all leading-relaxed transition-colors"
                >
                  {DELEGATION_ID}
                </a>
                <div className="mt-4">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Package</p>
                  <a
                    href={`${EXPLORER}/object/${PACKAGE_ID}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-[11px] font-mono text-zinc-500 hover:text-zinc-400 break-all transition-colors"
                  >
                    {short(PACKAGE_ID, 12)}
                  </a>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-3">Decision trail</p>
                <div className="space-y-2.5">
                  {[
                    { n: '0', label: 'Portfolio read (Tatum RPC)' },
                    { n: '1', label: 'Composition analysis' },
                    { n: '2', label: 'Rebalance recommendation' },
                  ].map(({ n, label }) => (
                    <div key={n} className="flex items-center gap-2.5 text-xs text-zinc-400">
                      <span className="w-5 h-5 rounded-full bg-amber-900/30 border border-amber-800/40 flex items-center justify-center flex-shrink-0">
                        <span className="text-[9px] font-bold text-amber-400">{n}</span>
                      </span>
                      {label}
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-xs text-zinc-600 pl-0.5 pt-1">
                    <GitCommit size={11} />
                    keccak256 · Walrus · 5 epochs
                  </div>
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-3">Settlement</p>
                <p className="text-2xl font-bold text-green-400 mb-1">1.00 USDC</p>
                <p className="text-xs text-zinc-600 mb-4">released to agent</p>
                <div className="space-y-1.5 text-xs text-zinc-600">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck size={11} className="text-green-600" /> Commitments verified
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Lock size={11} className="text-indigo-600" /> Seal policy checked
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Database size={11} className="text-violet-600" /> Blobs live on Walrus
                  </div>
                </div>
              </div>
            </div>

            {/* CTA */}
            <div className="px-6 pb-6">
              <Link href="/inspector" className="block">
                <motion.div
                  whileHover={{ scale: 1.01, boxShadow: '0 0 40px -8px rgba(99,102,241,0.5)' }}
                  whileTap={{ scale: 0.99 }}
                  className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors shadow-lg shadow-indigo-900/30"
                >
                  Inspect the trail — click to decrypt each node
                  <ArrowUpRight size={15} />
                </motion.div>
              </Link>
            </div>
          </GlassCard>
        </FadeUp>
      </section>

      {/* ── Built on ──────────────────────────────────────────────────────── */}
      <section className="py-12 sm:py-24 px-6 max-w-6xl mx-auto">
        <FadeUp className="text-center mb-4 space-y-3">
          <SectionLabel>Built on</SectionLabel>
          <h2 className="text-3xl sm:text-4xl font-bold text-zinc-50">The stack is load-bearing.</h2>
        </FadeUp>
        <FadeUp delay={0.05} className="text-center mb-14">
          <p className="text-sm text-zinc-600 max-w-sm mx-auto">
            Remove any layer and the proof guarantee degrades to &ldquo;trust me.&rdquo;
          </p>
        </FadeUp>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StackCard
            icon={Layers} name="Sui" href="https://sui.io" badge="Move 2024"
            role="Smart contracts, shared escrow, USDC payments, on-chain commitment anchoring."
          />
          <StackCard
            icon={Database} name="Walrus" href="https://walrus.xyz" badge="testnet"
            role="Decentralised blob storage for node payloads. Content-addressed, tamper-evident."
          />
          <StackCard
            icon={KeyRound} name="Seal" href="https://docs.sui.io/sui-stack/seal" badge={short(SEAL_PKG, 6)}
            role="Per-node encryption + selective principal decrypt via on-chain key server policy."
          />
          <StackCard
            icon={Zap} name="Tatum" href="https://tatum.io" badge="MCP"
            role="Sui RPC gateway. Agent reads chain state; all reads are logged as data_inputs in the trail."
          />
        </div>

        {/* Contract address pill */}
        <FadeUp delay={0.2} className="mt-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-5 py-4 rounded-2xl glass glow-border">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">Escrow contract · Sui testnet</p>
              <a
                href={`${EXPLORER}/object/${PACKAGE_ID}`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs font-mono text-indigo-400 hover:text-indigo-300 transition-colors break-all"
              >
                {PACKAGE_ID}
              </a>
            </div>
            <a
              href={`${EXPLORER}/object/${PACKAGE_ID}`}
              target="_blank" rel="noopener noreferrer"
              className="flex-shrink-0 flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-xl glass glow-border text-zinc-400 hover:text-zinc-200 transition-all"
            >
              Suiscan <ExternalLink size={11} />
            </a>
          </div>
        </FadeUp>
      </section>

      {/* ── Feature cards ─────────────────────────────────────────────────── */}
      <section className="py-12 sm:py-24 px-6 max-w-6xl mx-auto">
        <div className="grid sm:grid-cols-3 gap-5">
          <FeatureCard
            icon={ShieldCheck} delay={0}
            title="Cryptographic proof"
            body="Every decision node is keccak256-committed on-chain. Tamper any blob and verification fails — no payout."
          />
          <FeatureCard
            icon={Eye} delay={0.1}
            title="Private by default"
            body="Seal encrypts each node independently. Only the principal can decrypt via an on-chain policy enforced by the key server."
          />
          <FeatureCard
            icon={Lock} delay={0.2}
            title="Escrow enforces it"
            body="USDC is locked in a Sui smart contract. No valid trail = no release. The proof is the payment condition."
          />
        </div>
      </section>

      {/* ── Footer (CONVERTO-inspired) ─────────────────────────────────────── */}
      <footer className="border-t border-white/[0.05] bg-[#030307]/60 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 pt-10 sm:pt-16 pb-0">
          {/* Footer top grid */}
          <div className="grid sm:grid-cols-4 gap-10 pb-16">
            {/* Brand */}
            <div className="sm:col-span-1">
              <div className="flex items-center gap-2.5 mb-4">
                <LogoMark size={26} />
                <span className="font-semibold text-zinc-200">Provenant</span>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed max-w-[200px]">
                Proof-gated escrow on Sui. Agents get paid because they can prove how they decided.
              </p>
            </div>

            {/* Links */}
            {[
              {
                heading: 'Contract',
                links: [
                  { label: 'Escrow module', href: `${EXPLORER}/object/${PACKAGE_ID}` },
                  { label: 'Delegation object', href: `${EXPLORER}/object/${DELEGATION_ID}` },
                  { label: 'Seal package', href: `${EXPLORER}/object/${SEAL_PKG}` },
                ],
              },
              {
                heading: 'Platform',
                links: [
                  { label: 'Inspector', href: '/inspector' },
                  { label: 'Settlement tx', href: `${EXPLORER}/tx/xa9AMxNfgNR57Rx42Yfci2ucmBDKFYKkhdct1ZDfi5k` },
                ],
              },
              {
                heading: 'Stack',
                links: [
                  { label: 'Sui', href: 'https://sui.io' },
                  { label: 'Walrus', href: 'https://walrus.xyz' },
                  { label: 'Seal', href: 'https://docs.sui.io/sui-stack/seal' },
                  { label: 'Tatum', href: 'https://tatum.io' },
                ],
              },
            ].map(({ heading, links }) => (
              <div key={heading}>
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-4 font-semibold">{heading}</p>
                <ul className="space-y-2.5">
                  {links.map(({ label, href }) => (
                    <li key={label}>
                      {href.startsWith('/') ? (
                        <Link href={href} className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors">
                          {label}
                        </Link>
                      ) : (
                        <a href={href} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors">
                          {label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom divider */}
          <div className="border-t border-white/[0.04] py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-700">Built on Sui testnet · Walrus + Seal</p>
            <p className="text-[11px] text-zinc-700 font-mono">{short(PACKAGE_ID, 10)}</p>
          </div>
        </div>

        {/* Large brand text (CONVERTO-style) */}
        <FadeUp className="overflow-hidden">
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 1, ease }}
            className="px-4 sm:px-6 leading-none select-none"
            style={{
              fontSize: 'clamp(72px, 16vw, 220px)',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              letterSpacing: '-0.04em',
            }}
          >
            PROVENANT
          </motion.div>
        </FadeUp>
      </footer>
    </div>
  );
}
