import React, { useState } from 'react';
import { Layers, Shield, Plus, Check, RefreshCw, Star } from 'lucide-react';
import { sshExec } from '../../../lib/tauri-bridge';

interface FirewalldZoneManagerProps {
  connId: string;
  activeZone?: string;
  allZones: string[];
  onAddRuleClick: () => void;
  onRefresh: () => void;
}

export default function FirewalldZoneManager({
  connId,
  activeZone = 'public',
  allZones,
  onAddRuleClick,
  onRefresh,
}: FirewalldZoneManagerProps) {
  const [selectedZone, setSelectedZone] = useState<string>(activeZone || 'public');
  const [zoneDetails, setZoneDetails] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const loadZoneDetails = async (zName: string) => {
    setSelectedZone(zName);
    setLoading(true);
    try {
      const res = await sshExec(connId, `sudo firewall-cmd --zone=${zName} --list-all 2>&1`);
      setZoneDetails(res.stdout || 'No details available.');
    } catch {
      setZoneDetails('Failed to load zone details.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefaultZone = async (zName: string) => {
    try {
      await sshExec(connId, `sudo firewall-cmd --set-default-zone=${zName} && sudo firewall-cmd --reload`);
      onRefresh();
    } catch (err) {
      console.warn('Failed to set default zone:', err);
    }
  };

  const zonesList = allZones.length > 0 ? allZones : ['public', 'home', 'work', 'internal', 'external', 'dmz', 'drop', 'block', 'trusted'];

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <Layers className="w-4 h-4 text-purple-400" />
            <span>Firewalld Security Zones</span>
          </h3>
          <p className="text-xs text-gray-400">
            Multi-zone trust levels and service assignments for firewalld
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onAddRuleClick}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md active:scale-95 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Port / Service to Zone</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Zones List */}
        <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-3 space-y-1.5">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 mb-1">
            Available Zones ({zonesList.length})
          </div>
          {zonesList.map(z => {
            const isActive = z === activeZone;
            const isSelected = z === selectedZone;

            return (
              <div
                key={z}
                onClick={() => loadZoneDetails(z)}
                className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-blue-600 text-white font-medium shadow-md'
                    : 'hover:bg-white/5 text-gray-300 hover:text-white'
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <Shield className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400' : 'text-purple-400'}`} />
                  <span className="text-xs font-mono capitalize">{z}</span>
                </div>
                <div className="flex items-center space-x-1">
                  {isActive && (
                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold uppercase">
                      Default
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Zone Details Terminal / Specs */}
        <div className="col-span-2 bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-white text-sm uppercase font-mono">{selectedZone} Zone</span>
                {selectedZone === activeZone && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-bold">
                    Active Default Zone
                  </span>
                )}
              </div>
              {selectedZone !== activeZone && (
                <button
                  onClick={() => handleSetDefaultZone(selectedZone)}
                  className="px-2.5 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-amber-300 text-[11px] font-medium border border-white/10 transition-colors flex items-center space-x-1"
                >
                  <Star className="w-3 h-3 text-amber-400" />
                  <span>Set as Default Zone</span>
                </button>
              )}
            </div>

            <div className="mt-3 bg-black/50 border border-white/10 rounded-xl p-3 font-mono text-[11px] text-gray-300 max-h-72 overflow-y-auto">
              {loading ? (
                <div className="flex items-center space-x-2 text-blue-400 py-4">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading zone configurations...</span>
                </div>
              ) : zoneDetails ? (
                <pre className="whitespace-pre-wrap leading-relaxed">{zoneDetails}</pre>
              ) : (
                <div className="text-gray-500 py-4">
                  Select a zone on the left to inspect its active services, ports, interfaces, and rich rules.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
