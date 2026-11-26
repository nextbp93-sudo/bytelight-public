import React, { useState } from "react";
import { motion } from "motion/react";
import { ShieldCheck, Loader2 } from "lucide-react";

interface AuthGateProps {
  onLogin: (key: string) => Promise<void>;
  error: string | null;
  testing: boolean;
}

export function AuthGate({ onLogin, error, testing }: AuthGateProps) {
  const [key, setKey] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) onLogin(key.trim());
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="bg-[#12121a]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center justify-center mb-6">
            <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-purple-400" />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white text-center mb-2">
            Neuralis OS
          </h1>
          <p className="text-sm text-white/50 text-center mb-8">
            Connect to your cognitive backend
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="api-key"
                className="block text-xs text-white/40 mb-1.5 uppercase tracking-wider"
              >
                API Key
              </label>
              <input
                id="api-key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Enter your MIND_API_KEY"
                autoFocus
                className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-lg text-white placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all"
              />
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-sm text-red-400"
              >
                {error}
              </motion.p>
            )}

            <button
              type="submit"
              disabled={testing || !key.trim()}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/30 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {testing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </button>
          </form>

          <p className="text-xs text-white/30 text-center mt-6">
            Key is stored locally and never sent anywhere except your worker.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
