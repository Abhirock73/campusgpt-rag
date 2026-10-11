import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import {
  User,
  Mail,
  Shield,
  BookOpen,
  Calendar,
  CheckCircle2,
  RefreshCw,
  GraduationCap,
} from 'lucide-react';

const Profile = () => {
  const { user: cachedUser } = useAuth();
  const [profileData, setProfileData] = useState(cachedUser);
  const [loading, setLoading] = useState(false);
  const [synced, setSynced] = useState(false);

  const fetchFreshProfile = async () => {
    setLoading(true);
    try {
      const res = await authAPI.getMe();
      if (res?.data?.user) {
        setProfileData(res.data.user);
        setSynced(true);
        setTimeout(() => setSynced(false), 3000);
      }
    } catch (err) {
      console.error('Failed to sync profile:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (cachedUser && !profileData) {
      setProfileData(cachedUser);
    }
  }, [cachedUser, profileData]);

  useEffect(() => {
    fetchFreshProfile();
  }, []);

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-campus-accent" />
            Campus Student Profile
          </h1>
          <p className="text-sm text-campus-muted">
            Verified academic credentials and platform profile
          </p>
        </div>

        <button
          onClick={fetchFreshProfile}
          disabled={loading}
          className="campus-btn-secondary text-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Syncing...' : 'Sync from Server'}
        </button>
      </div>

      {synced && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>Profile synced successfully with live backend (/api/auth/me)</span>
        </div>
      )}

      {/* Profile Card */}
      <div className="campus-card p-6 sm:p-8 space-y-6">
        {/* User Identity Header */}
        <div className="flex items-center gap-4 pb-6 border-b border-campus-border">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-2xl font-bold uppercase shadow-sm">
            {profileData?.name?.charAt(0) || 'U'}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-white">{profileData?.name}</h2>
              <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded font-semibold ${
                profileData?.role === 'admin'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              }`}>
                {profileData?.role}
              </span>
            </div>
            <p className="text-sm text-campus-muted flex items-center gap-1.5 font-mono">
              <Mail className="w-3.5 h-3.5" />
              {profileData?.email}
            </p>
          </div>
        </div>

        {/* Credentials Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-campus-bg border border-campus-border space-y-1">
            <span className="text-[11px] font-mono text-campus-muted flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-blue-400" />
              Academic Department
            </span>
            <p className="text-sm font-medium text-white">{profileData?.department || 'General'}</p>
          </div>

          <div className="p-4 rounded-lg bg-campus-bg border border-campus-border space-y-1">
            <span className="text-[11px] font-mono text-campus-muted flex items-center gap-1.5">
              <GraduationCap className="w-3.5 h-3.5 text-blue-400" />
              Academic Standing / Year
            </span>
            <p className="text-sm font-medium text-white">{profileData?.year || '1st Year'}</p>
          </div>

          <div className="p-4 rounded-lg bg-campus-bg border border-campus-border space-y-1">
            <span className="text-[11px] font-mono text-campus-muted flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-purple-400" />
              Platform Role
            </span>
            <p className="text-sm font-medium text-white capitalize">{profileData?.role || 'student'}</p>
          </div>

          <div className="p-4 rounded-lg bg-campus-bg border border-campus-border space-y-1">
            <span className="text-[11px] font-mono text-campus-muted flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-400" />
              Registered Date
            </span>
            <p className="text-sm font-medium text-white">{formatDate(profileData?.createdAt)}</p>
          </div>
        </div>

        {/* Security & Token Info */}
        <div className="pt-4 border-t border-campus-border text-xs text-campus-muted flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span>Security: Authenticated via JWT (Encrypted with bcrypt)</span>
          <span className="font-mono text-[11px]">User ID: {profileData?._id}</span>
        </div>
      </div>
    </div>
  );
};

export default Profile;
