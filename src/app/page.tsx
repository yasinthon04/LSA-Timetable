'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  Schedule, Teacher, Subject, YearGroup, Student,
  ScheduleFormData, DAY_NAMES, SCHOOL_START, SCHOOL_END,
  LUNCH_BREAK_1_START, LUNCH_BREAK_1_END, LUNCH_BREAK_2_START, LUNCH_BREAK_2_END,
  SUBJECT_COLORS, TEACHER_COLORS, DAY_FULL_NAMES,
} from '@/lib/types';
// ===== HELPERS =====
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function calculateTeacherHours(schedules: Schedule[], teacherId: string): string {
  const teacherSchedules = schedules.filter(s => s.teacherId === teacherId);
  let totalMinutes = 0;
  for (const s of teacherSchedules) {
    totalMinutes += timeToMinutes(s.endTime) - timeToMinutes(s.startTime);
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// ===== CONFIG =====
const TIME_PERIODS = [
  { id: 'p0', label: '07:30 - 07:45', start: '07:30', end: '07:45' },
  { id: 'p1', label: '08:00 - 09:00', start: '08:00', end: '09:00', display: '1' },
  { id: 'p2', label: '09:00 - 10:00', start: '09:00', end: '10:00', display: '2' },
  { id: 'b1', label: '10:00 - 10:20', start: '10:00', end: '10:20', isBreak: true },
  { id: 'p3', label: '10:20 - 11:20', start: '10:20', end: '11:20', display: '3' },
  { id: 'p4', label: '11:20 - 12:20', start: '11:20', end: '12:20', display: '4' },
  { id: 'p5', label: '12:20 - 13:10', start: '12:20', end: '13:10', display: '5' },
  { id: 'p6', label: '13:10 - 14:15', start: '13:10', end: '14:15', display: '6' },
  { id: 'end', label: '14:15 - 14:30', start: '14:15', end: '14:30', isBreak: true },
];

function isScheduleInPeriod(schedule: Schedule, periodStart: string, periodEnd: string): boolean {
  const sStart = timeToMinutes(schedule.startTime);
  const sEnd = timeToMinutes(schedule.endTime);
  const pStart = timeToMinutes(periodStart);
  const pEnd = timeToMinutes(periodEnd);
  // Check overlap: max(start1, start2) < min(end1, end2)
  return Math.max(sStart, pStart) < Math.min(sEnd, pEnd);
}

// ===== MAIN APP =====
type ActivePage = 'calendar' | 'teachers' | 'subjects' | 'students';

export default function Home() {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === 'ADMIN';
  const [activePage, setActivePage] = useState<ActivePage>('calendar');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [yearGroups, setYearGroups] = useState<YearGroup[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedYearGroup, setSelectedYearGroup] = useState<string>('');
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<string>>(new Set());
  const [teacherFilter, setTeacherFilter] = useState(''); // Teacher search
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<Set<string>>(new Set());
  const [subjectFilter, setSubjectFilter] = useState(''); // Text search (keep existing)
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState<{
    open: boolean;
    mode: 'create' | 'edit' | 'read';
    schedule?: Schedule;
    prefill?: Partial<ScheduleFormData>;
  }>({ open: false, mode: 'create' });

  const [teacherModal, setTeacherModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    teacher?: Teacher;
  }>({ open: false, mode: 'create' });

  const [subjectModal, setSubjectModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    subject?: Subject;
  }>({ open: false, mode: 'create' });

  const [confirmationModal, setConfirmationModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => { } });

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const confirmDelete = (title: string, message: string, onConfirm: () => void) => {
    setConfirmationModal({ open: true, title, message, onConfirm });
  };

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Edit Mode States
  const [isEditMode, setIsEditMode] = useState(false);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [isSavingBulk, setIsSavingBulk] = useState(false);
  const [editSnapshot, setEditSnapshot] = useState<Schedule[]>([]);

  // Set mounted flag
  useEffect(() => {
    setMounted(true);
  }, []);

  // Show toast
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Fetch all data
  const fetchData = useCallback(async () => {
    try {
      const [teachersRes, subjectsRes, yearGroupsRes, studentsRes] = await Promise.all([
        fetch('/api/teachers', { cache: 'no-store' }),
        fetch('/api/subjects', { cache: 'no-store' }),
        fetch('/api/year-groups', { cache: 'no-store' }),
        fetch('/api/students', { cache: 'no-store' }),
      ]);
      const [t, s, y, st] = await Promise.all([
        teachersRes.json(),
        subjectsRes.json(),
        yearGroupsRes.json(),
        studentsRes.json(),
      ]);
      // Ensure all responses are arrays before setting state
      setTeachers(Array.isArray(t) ? t : []);
      setSubjects(Array.isArray(s) ? s : []);
      setYearGroups(Array.isArray(y) ? y : []);
      setStudents(Array.isArray(st) ? st : []);
      // Removed auto-select first year group to support "All Years" default
    } catch {
      showToast('Failed to load data', 'error');
    }
  }, [showToast]);

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch('/api/schedules', { cache: 'no-store' });
      const data = await res.json();
      setSchedules(data);
    } catch {
      showToast('Failed to load schedules', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    Promise.all([fetchData(), fetchSchedules()]).then(() => setLoading(false));
  }, [fetchData, fetchSchedules]);

  // No filteredSchedules state needed for rendering anymore
  // We filter inside the render to show all but dim unselected
  const allSchedules = useMemo(() => schedules, [schedules]);

  const groupedSubjectsByType = useMemo(() => {
    const groups: Record<string, Subject[]> = {};
    subjects.forEach(s => {
      const t = s.type || 'MAIN';
      if (!groups[t]) groups[t] = [];
      groups[t].push(s);
    });
    return groups;
  }, [subjects]);

  const subjectTypesList = useMemo(() => {
    const order = ['MAIN', 'INTERVENTION', 'BOOSTER'];
    return Object.keys(groupedSubjectsByType).sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [groupedSubjectsByType]);


  // Edit Mode Actions
  const handleEnterEditMode = () => {
    setEditSnapshot([...schedules]);
    setIsEditMode(true);
    setDeletedIds(new Set());
    showToast('Edit Mode: ON. Changes are local until you click Save All.', 'success');
  };

  const handleCancelEditMode = () => {
    setSchedules(editSnapshot);
    setIsEditMode(false);
    setDeletedIds(new Set());
    showToast('Edit Mode: OFF. Changes discarded.', 'error');
  };

  const handleBulkSave = async () => {
    setIsSavingBulk(true);
    try {
      // 1. Deletions
      const deletePromises = Array.from(deletedIds).map(id =>
        fetch(`/api/schedules/${id}`, { method: 'DELETE' })
      );

      // 2. Creates & Updates
      const mutations = schedules.map(s => {
        const isNew = s.id.startsWith('temp-');
        const original = editSnapshot.find(os => os.id === s.id);

        const hasChanged = !original || (
          original.teacherId !== s.teacherId ||
          original.subjectId !== s.subjectId ||
          original.yearGroupId !== s.yearGroupId ||
          original.dayOfWeek !== s.dayOfWeek ||
          original.startTime !== s.startTime ||
          original.endTime !== s.endTime
        );

        if (isNew) {
          return fetch('/api/schedules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              teacherId: s.teacherId,
              subjectId: s.subjectId,
              yearGroupId: s.yearGroupId,
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime
            })
          });
        } else if (hasChanged) {
          return fetch(`/api/schedules/${s.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              teacherId: s.teacherId,
              subjectId: s.subjectId,
              yearGroupId: s.yearGroupId,
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime
            })
          });
        }
        return null;
      }).filter(p => p !== null) as Promise<Response>[];

      await Promise.all([...deletePromises, ...mutations]);

      showToast('All changes saved to cloud', 'success');
      setIsEditMode(false);
      setDeletedIds(new Set());
      await fetchSchedules();
    } catch (err) {
      console.error(err);
      showToast('Failed to save some changes', 'error');
    } finally {
      setIsSavingBulk(false);
    }
  };

  // Schedule CRUD
  const handleSaveSchedule = async (data: ScheduleFormData, id?: string) => {
    const previousSchedules = [...schedules];

    // Close modal immediately for instant feedback
    setModalState({ open: false, mode: 'create' });

    try {
      if (id) {
        // Optimistic update for existing schedules
        setSchedules(prev => prev.map(s => s.id === id ? { ...s, ...data } as Schedule : s));
      } else {
        // Optimistic create for new schedules
        const tempId = `temp-${Date.now()}`;
        const newSchedule: Schedule = {
          id: tempId,
          teacherId: data.teacherId,
          subjectId: data.subjectId,
          yearGroupId: data.yearGroupId || null,
          dayOfWeek: data.dayOfWeek,
          startTime: data.startTime,
          endTime: data.endTime,
          createdAt: new Date().toISOString(),
          // Populate relations for tooltip/rendering
          teacher: teachers.find(t => t.id === data.teacherId)!,
          subject: subjects.find(s => s.id === data.subjectId)!,
          yearGroup: yearGroups.find(y => y.id === data.yearGroupId),
          studentSchedules: []
        };
        setSchedules(prev => [...prev, newSchedule]);
      }

      // If in edit mode, stop here and don't call API
      if (isEditMode) {
        showToast(id ? 'Update pending (Edit Mode)' : 'Creation pending (Edit Mode)');
        return;
      }

      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/schedules/${id}` : '/api/schedules';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.details || result.error || 'Unknown error');
      }

      // Re-fetch in background to sync with server IDs and relationships
      await fetchSchedules();
      showToast(id ? 'Schedule updated' : 'Schedule created');
    } catch (err: any) {
      // Rollback on error
      setSchedules(previousSchedules);
      console.error('Save error:', err);
      showToast(`Failed to save: ${err.message}`, 'error');
      // Re-open if failed? Usually users prefer correction
      setModalState({ open: true, mode: id ? 'edit' : 'create', schedule: id ? schedules.find(s => s.id === id) : undefined, prefill: data });
    }
  };



  // Drag & Drop Handlers
  const handleDragStart = (e: React.DragEvent, type: 'create' | 'move', data: { subjectId?: string; scheduleId?: string }) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ type, data }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, targetTeacherId: string, targetDay: number, period: typeof TIME_PERIODS[0]) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/json');
    if (!raw) return;

    const { type, data } = JSON.parse(raw);
    const targetYearGroupId = selectedYearGroup || (yearGroups.length > 0 ? yearGroups[0].id : ''); // Default year group

    if (!targetYearGroupId) {
      showToast('Please select a Year Group first', 'error');
      return;
    }

    const pStartMin = timeToMinutes(period.start);
    const pEndMin = timeToMinutes(period.end);

    // Find all overlapping schedules for this teacher/day (across ALL year groups)
    const overlaps = schedules.filter(s =>
      s.teacherId === targetTeacherId &&
      s.dayOfWeek === targetDay &&
      isScheduleInPeriod(s, period.start, period.end)
    ).sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    // Calculate the first available gap in this period
    let finalStart = pStartMin;
    let finalEnd = pEndMin;
    let targetScheduleIdToDelete = null;
    let isFull = false;

    if (overlaps.length > 0) {
      let currentPos = pStartMin;
      let gapFound = false;

      for (const s of overlaps) {
        const sStart = timeToMinutes(s.startTime);
        const sEnd = timeToMinutes(s.endTime);

        if (sStart > currentPos) {
          finalStart = currentPos;
          finalEnd = sStart;
          gapFound = true;
          break;
        }
        currentPos = Math.max(currentPos, sEnd);
      }

      if (!gapFound && currentPos < pEndMin) {
        finalStart = currentPos;
        finalEnd = pEndMin;
        gapFound = true;
      }

      if (!gapFound) {
        isFull = true;
        // Find if we should replace something (usually the first overlap or one in same year group)
        const sameYearOverlap = overlaps.find(s => s.yearGroupId === targetYearGroupId);
        targetScheduleIdToDelete = (sameYearOverlap || overlaps[0]).id;
      }
    }

    try {
      if (type === 'create') {
        const subjectId = data.subjectId;

        if (isFull && targetScheduleIdToDelete) {
          await fetch(`/api/schedules/${targetScheduleIdToDelete}`, { method: 'DELETE' });
          // If replacing, use full period
          finalStart = pStartMin;
          finalEnd = pEndMin;
        }

        await handleSaveSchedule({
          teacherId: targetTeacherId,
          subjectId,
          yearGroupId: targetYearGroupId,
          dayOfWeek: targetDay,
          startTime: minutesToTime(finalStart),
          endTime: minutesToTime(finalEnd)
        });

      } else if (type === 'move') {
        const sourceScheduleId = data.scheduleId;
        const sourceSchedule = schedules.find(s => s.id === sourceScheduleId);
        if (!sourceSchedule) return;

        // Verify we aren't dropping on self
        if (isFull && targetScheduleIdToDelete === sourceSchedule.id) return;

        if (isFull && targetScheduleIdToDelete) {
          const targetSchedule = overlaps.find(o => o.id === targetScheduleIdToDelete);
          if (!targetSchedule) return;

          // SWAP Logic
          const sourceCoords = {
            teacherId: sourceSchedule.teacherId,
            dayOfWeek: sourceSchedule.dayOfWeek,
            startTime: sourceSchedule.startTime,
            endTime: sourceSchedule.endTime
          };

          await handleSaveSchedule({
            ...sourceSchedule,
            teacherId: targetTeacherId,
            dayOfWeek: targetDay,
            startTime: targetSchedule.startTime,
            endTime: targetSchedule.endTime,
            subjectId: sourceSchedule.subjectId,
            yearGroupId: sourceSchedule.yearGroupId
          }, sourceSchedule.id);

          await handleSaveSchedule({
            ...targetSchedule,
            ...sourceCoords,
            subjectId: targetSchedule.subjectId,
            yearGroupId: targetSchedule.yearGroupId
          }, targetSchedule.id);

          showToast('Schedules switched');

        } else {
          // MOVE Logic (Fill Gap or Empty)
          await handleSaveSchedule({
            ...sourceSchedule,
            teacherId: targetTeacherId,
            dayOfWeek: targetDay,
            startTime: minutesToTime(finalStart),
            endTime: minutesToTime(finalEnd),
            subjectId: sourceSchedule.subjectId,
            yearGroupId: sourceSchedule.yearGroupId
          }, sourceSchedule.id);
        }
      }
    } catch (err) {
      console.error(err);
      showToast('Action failed', 'error');
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    const previousSchedules = [...schedules];
    try {
      // Optimistic delete
      setSchedules(prev => prev.filter(s => s.id !== id));

      if (isEditMode) {
        if (!id.startsWith('temp-')) {
          setDeletedIds(prev => {
            const next = new Set(prev);
            next.add(id);
            return next;
          });
        }
        setModalState({ open: false, mode: 'create' });
        showToast('Delete pending (Edit Mode)');
        return;
      }

      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await fetchSchedules();
      setModalState({ open: false, mode: 'create' });
      showToast('Schedule deleted');
    } catch {
      // Rollback
      setSchedules(previousSchedules);
      showToast('Failed to delete schedule', 'error');
    }
  };

  // Teacher CRUD  
  const handleSaveTeacher = async (data: { name: string; email: string; color: string }, id?: string) => {
    try {
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/teachers/${id}` : '/api/teachers';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error();
      await fetchData();
      await fetchSchedules();
      setTeacherModal({ open: false, mode: 'create' });
      showToast(id ? 'Teacher updated' : 'Teacher added');
    } catch {
      showToast('Failed to save teacher', 'error');
    }
  };

  const handleDeleteTeacher = async (id: string) => {
    try {
      const res = await fetch(`/api/teachers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await fetchData();
      await fetchSchedules();
      setTeacherModal({ open: false, mode: 'create' });
      showToast('Teacher deleted');
    } catch {
      showToast('Failed to delete teacher', 'error');
    }
  };

  // Subject CRUD
  const handleSaveSubject = async (data: { name: string; color: string; type: string }, id?: string) => {
    try {
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/subjects/${id}` : '/api/subjects';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error();
      await fetchData();
      setSubjectModal({ open: false, mode: 'create' });
      showToast(id ? 'Subject updated' : 'Subject added');
    } catch {
      showToast('Failed to save subject', 'error');
    }
  };

  const handleDeleteSubject = async (id: string) => {
    try {
      const res = await fetch(`/api/subjects/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await fetchData();
      await fetchSchedules();
      setSubjectModal({ open: false, mode: 'create' });
      showToast('Subject deleted');
    } catch {
      showToast('Failed to delete subject', 'error');
    }
  };

  const handleAddStudent = async (name: string) => {
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const newStudent = await res.json();
      setStudents(prev => [...prev, newStudent].sort((a, b) => a.name.localeCompare(b.name)));
      showToast('Student added');
    } catch {
      showToast('Failed to add student', 'error');
    }
  };

  const handleDeleteStudent = async (id: string) => {
    try {
      const res = await fetch(`/api/students/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setStudents(prev => prev.filter(s => s.id !== id));
      showToast('Student deleted');
    } catch {
      showToast('Failed to delete student', 'error');
    }
  };

  // Teacher toggle
  const toggleTeacher = (id: string) => {
    setSelectedTeacherIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  if (loading || !mounted) {
    return (
      <div className="app-layout">
        <div className="loading-spinner" style={{ width: '100%', height: '100vh' }}>
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      {mobileMenuOpen && <div className="mobile-overlay" onClick={() => setMobileMenuOpen(false)}></div>}
      {/* SIDEBAR */}
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''} ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo" style={{ background: 'none', padding: 0, overflow: 'hidden' }}>
            <img src="/logo.png" alt="LSA Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          {!isSidebarCollapsed && <span className="sidebar-title">LSA Timetable</span>}
          <button
            className="sidebar-toggle-btn"
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          >
            {isSidebarCollapsed ? '»' : '«'}
          </button>
        </div>

        <div className="sidebar-content">
          {/* Subject Legend */}
          <div className="sidebar-section">
            <div className="sidebar-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: isSidebarCollapsed ? 0 : 'auto', overflow: 'hidden' }}>
              {!isSidebarCollapsed && <span>Subjects</span>}
              {!isSidebarCollapsed && (
                <button
                  className="btn-text"
                  style={{ fontSize: 11, padding: '2px 6px', color: 'var(--text-muted)', cursor: 'pointer', background: 'transparent', border: 'none' }}
                  onClick={() => setSelectedSubjectIds(new Set())}
                >Clear</button>
              )}
            </div>
            {!isSidebarCollapsed && (
              <input
                type="text"
                placeholder="Search subjects..."
                className="form-input"
                style={{ marginBottom: 12, fontSize: 13, padding: '6px 8px' }}
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
              />
            )}

            <div className="sidebar-subjects-list" style={{ overflowY: 'auto', flex: 1 }}>
              {subjectTypesList.map(type => (
                <div key={type} className="sidebar-group" style={{ marginBottom: 16 }}>
                  {!isSidebarCollapsed && (
                    <div className="sidebar-group-title" style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center' }}>
                      <span className={`badge badge-${type.toLowerCase()}`} style={{ fontSize: 9 }}>{type}</span>
                    </div>
                  )}
                  {groupedSubjectsByType[type]
                    .filter(s => s.name.toLowerCase().includes(subjectFilter.toLowerCase()))
                    .map(subject => (
                      <div
                        key={subject.id}
                        className={`sidebar-item ${selectedSubjectIds.has(subject.id) ? 'active' : ''}`}
                        draggable={isAdmin && isEditMode}
                        onDragStart={(e) => isAdmin && isEditMode && handleDragStart(e, 'create', { subjectId: subject.id })}
                        onClick={() => {
                          setSelectedSubjectIds(prev => {
                            const next = new Set(prev);
                            if (next.has(subject.id)) next.delete(subject.id); else next.add(subject.id);
                            return next;
                          });
                        }}
                        style={{
                          cursor: 'pointer',
                          opacity: selectedSubjectIds.size > 0 && !selectedSubjectIds.has(subject.id) ? 0.5 : 1,
                          border: selectedSubjectIds.has(subject.id) ? `1px solid ${subject.color}` : '1px solid transparent',
                          justifyContent: isSidebarCollapsed ? 'center' : 'flex-start',
                          marginBottom: 4,
                          padding: '6px 8px',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          transition: 'all 0.2s'
                        }}
                        title={subject.name}
                      >
                        <div className="sidebar-dot" style={{ backgroundColor: subject.color, width: 8, height: 8, borderRadius: '50%' }}></div>
                        {!isSidebarCollapsed && <span className="sidebar-item-text" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject.name}</span>}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-primary)', margin: '8px 16px' }}></div>

          {/* Teacher Filter */}
          <div className="sidebar-section">
            <div className="sidebar-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isSidebarCollapsed ? 0 : 12, height: isSidebarCollapsed ? 0 : 'auto', overflow: 'hidden' }}>
              {!isSidebarCollapsed && <span>Teachers</span>}
              {!isSidebarCollapsed && (
                <button
                  className="btn-text"
                  style={{ fontSize: 11, padding: '2px 6px', color: 'var(--text-muted)', cursor: 'pointer', background: 'transparent', border: 'none' }}
                  onClick={() => setSelectedTeacherIds(new Set())}
                >Clear</button>
              )}
            </div>
            {!isSidebarCollapsed && (
              <input
                type="text"
                placeholder="Search teachers..."
                className="form-input"
                style={{ marginBottom: 12, fontSize: 13, padding: '6px 8px' }}
                value={teacherFilter}
                onChange={(e) => setTeacherFilter(e.target.value)}
              />
            )}
            {teachers
              .filter(t => t.name.toLowerCase().includes(teacherFilter.toLowerCase()))
              .map(teacher => (
                <div
                  key={teacher.id}
                  className={`sidebar-item ${selectedTeacherIds.has(teacher.id) ? 'active' : ''}`}
                  onClick={() => toggleTeacher(teacher.id)}
                  style={{
                    cursor: 'pointer',
                    opacity: selectedTeacherIds.size > 0 && !selectedTeacherIds.has(teacher.id) ? 0.5 : 1,
                    border: selectedTeacherIds.has(teacher.id) ? `1px solid ${teacher.color}` : '1px solid transparent',
                    justifyContent: isSidebarCollapsed ? 'center' : 'flex-start'
                  }}
                  title={teacher.name}
                >
                  {/* Optional checkbox can be removed or kept as visual indicator */}
                  <div className="sidebar-dot" style={{ backgroundColor: teacher.color, width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }}></div>
                  {!isSidebarCollapsed && (
                    <>
                      <span className="sidebar-item-text">{teacher.name}</span>
                      <span className="sidebar-item-hours">{calculateTeacherHours(schedules, teacher.id)}</span>
                    </>
                  )}
                </div>
              ))}
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="main-content">
        {/* TOP NAV */}
        <nav className="topnav">
          <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <div className="topnav-links">
            <a className={`topnav-link ${activePage === 'calendar' ? 'active' : ''}`} onClick={() => setActivePage('calendar')}>Timetable</a>
            <a className={`topnav-link ${activePage === 'subjects' ? 'active' : ''}`} onClick={() => setActivePage('subjects')}>Subjects</a>
            <a className={`topnav-link ${activePage === 'teachers' ? 'active' : ''}`} onClick={() => setActivePage('teachers')}>Teachers</a>
            <a className={`topnav-link ${activePage === 'students' ? 'active' : ''}`} onClick={() => setActivePage('students')}>Students</a>
          </div>
          <div className="topnav-right">
            {session?.user && (
              <div style={{ position: 'relative' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                    <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{session.user.name || session.user.email}</span>
                    {(session.user as any).role && (
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: (session.user as any).role === 'ADMIN' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(99, 102, 241, 0.1)',
                        color: (session.user as any).role === 'ADMIN' ? '#ef4444' : '#6366f1',
                        border: `1px solid ${(session.user as any).role === 'ADMIN' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.2)'}`,
                        letterSpacing: '0.05em'
                      }}>
                        Role: {(session.user as any).role}
                      </span>
                    )}
                  </div>
                  <div className="topnav-avatar">
                    {session.user.name?.[0]?.toUpperCase() || session.user.email?.[0]?.toUpperCase() || 'A'}
                  </div>
                </div>

                {userMenuOpen && (
                  <div className="user-dropdown-menu">
                    <Link
                      className="user-dropdown-item"
                      href="/profile"
                      style={{ textDecoration: 'none', display: 'block' }}
                      onClick={() => setUserMenuOpen(false)}
                    >
                      Edit Profile
                    </Link>
                    <div className="user-dropdown-divider"></div>
                    <div className="user-dropdown-item danger" onClick={() => signOut()}>Sign Out</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </nav>

        {/* CONTENT */}
        {activePage === 'calendar' && (
          <div className="timetable-container">
            {/* Filter Header */}
            {/* Filter Header */}
            <div className="timetable-filters" style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 24px',
              borderBottom: '1px solid var(--border-primary)',
              background: 'var(--bg-secondary)', // Distinct background
            }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Filter by Year:</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <select
                  className="form-select"
                  style={{
                    width: 'auto',
                    padding: '6px 32px 6px 12px',
                    fontSize: 13,
                    borderColor: 'var(--border-primary)',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    cursor: 'pointer',
                    backgroundImage: 'none'
                  }}
                  value={selectedYearGroup}
                  onChange={(e) => setSelectedYearGroup(e.target.value)}
                >
                  <option value="">All</option>
                  {yearGroups.map(yg => (
                    <option key={yg.id} value={yg.id}>{yg.name}</option>
                  ))}
                </select>
                <div style={{ position: 'absolute', right: 10, pointerEvents: 'none', color: 'var(--text-secondary)', display: 'flex' }}>
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {isAdmin && (
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
                  {!isEditMode ? (
                    <button
                      className="btn-edit-mode btn-edit-mode-enter"
                      onClick={handleEnterEditMode}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                      Edit Timetable
                    </button>
                  ) : (
                    <>
                      <button
                        className="btn-edit-mode btn-edit-mode-cancel"
                        onClick={handleCancelEditMode}
                        disabled={isSavingBulk}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        Cancel
                      </button>
                      <button
                        className="btn-edit-mode btn-edit-mode-save"
                        onClick={handleBulkSave}
                        disabled={isSavingBulk}
                      >
                        {isSavingBulk ? (
                          <>
                            <div className="btn-spinner"></div>
                            Saving...
                          </>
                        ) : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                            Save All Changes
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* TEACHER MATRIX */}
            <div className={`timetable-matrix ${isEditMode ? 'is-edit-mode' : ''}`}>
              {/* Main Header (Periods) */}
              <div className="matrix-header-row">
                <div className="col-day header-cell">Day</div>
                <div className="day-teachers-col" style={{ flex: 1 }}>
                  <div className="teacher-row" style={{ borderBottom: 'none', background: 'transparent' }}>
                    <div className="col-teacher header-cell">Teacher</div>
                    {TIME_PERIODS.map((p, index) => {
                      const duration = timeToMinutes(p.end) - timeToMinutes(p.start);
                      return (
                        <div
                          key={`${p.id}-${index}`}
                          className={`header-cell col-period ${p.isBreak ? 'is-break' : ''} ${p.id === 'p0' ? 'is-hr' : ''}`}
                          style={{
                            flexGrow: duration,
                            flexShrink: 0,
                            flexBasis: 0,
                          }}
                        >
                          <div className="header-period-combined">
                            <div className="header-name">{p.display || ''}</div>
                            <div className="header-time-range">
                              <span>{p.start}</span>
                              <span className="time-sep">-</span>
                              <span>{p.end}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Day Groups */}
              {[0, 1, 2, 3, 4].map(dayIdx => {
                // Use short name if filtering by subject OR teacher to prevent layout issues
                const dayName = (selectedSubjectIds.size > 0 || selectedTeacherIds.size > 0) ? DAY_NAMES[dayIdx] : DAY_FULL_NAMES[dayIdx];

                // Filter teachers:
                // 1. Must be in selectedTeacherIds (if any selected)
                // 2. If subjects selected, must handle whether to show teacher.
                //    Let's filter schedules first then decide if teacher shows.

                const currentTeachers = teachers
                  .filter(t => selectedTeacherIds.size === 0 || selectedTeacherIds.has(t.id))
                  .filter(t => {
                    // If no subjects selected, show all (that match teacher filter)
                    if (selectedSubjectIds.size === 0) return true;

                    // If subjects selected, does this teacher have ANY matching subject today?
                    const hasMatchingSchedule = allSchedules.some(s =>
                      s.teacherId === t.id &&
                      s.dayOfWeek === dayIdx &&
                      (!selectedYearGroup || s.yearGroupId === selectedYearGroup || !s.yearGroupId) &&
                      selectedSubjectIds.has(s.subjectId)
                    );
                    return hasMatchingSchedule;
                  })
                  .sort((a, b) => a.name.localeCompare(b.name));

                if (currentTeachers.length === 0) return null;

                return (
                  <div key={dayIdx} className="day-group">
                    {/* Day Label Column */}
                    <div className="col-day">
                      <div className="day-name-vertical">{dayName}</div>
                    </div>

                    {/* Teachers Rows Container */}
                    <div className="day-teachers-col">
                      {currentTeachers.map(teacher => {
                        // Get schedules for this teacher & day
                        // Apply Subject Filter here too so we only see relevant blocks?
                        const rowSchedules = allSchedules.filter(s =>
                          s.teacherId === teacher.id &&
                          s.dayOfWeek === dayIdx &&
                          (!selectedYearGroup || s.yearGroupId === selectedYearGroup || !s.yearGroupId) &&
                          (selectedSubjectIds.size === 0 || selectedSubjectIds.has(s.subjectId))
                        );

                        return (
                          <div key={teacher.id} className="teacher-row">
                            <div className="col-teacher">
                              <span className="teacher-dot" style={{ backgroundColor: teacher.color }}></span>
                              {teacher.name}
                            </div>

                            {/* Period Cells */}
                            {/* Period Cells */}
                            {TIME_PERIODS.map((period, pIndex) => { // Use index to avoid duplicate ID issues
                              const periodStart = timeToMinutes(period.start);
                              const periodEnd = timeToMinutes(period.end);
                              const periodDuration = periodEnd - periodStart;

                              const periodScheds = rowSchedules.filter(s => isScheduleInPeriod(s, period.start, period.end));

                              return (
                                <div
                                  key={`${period.id}-${pIndex}`}
                                  className={`period-cell ${period.isBreak ? 'is-break' : ''} ${period.id === 'p0' ? 'is-hr' : ''}`}
                                  style={{
                                    flexGrow: periodDuration,
                                    flexShrink: 0,
                                    flexBasis: 0,
                                    position: 'relative',
                                  }}

                                  // Drop Target (Container)
                                  onDragOver={isAdmin ? handleDragOver : undefined}
                                  onDrop={(isAdmin && isEditMode) ? (e) => handleDrop(e, teacher.id, dayIdx, period) : undefined}

                                  // Click empty space -> Create
                                  onClick={() => {
                                    if (!isAdmin || !isEditMode) return;
                                    setModalState({
                                      open: true, mode: 'create', prefill: {
                                        teacherId: teacher.id,
                                        dayOfWeek: dayIdx,
                                        startTime: period.start,
                                        endTime: period.end,
                                        yearGroupId: selectedYearGroup || (yearGroups.length > 0 ? yearGroups[0].id : ''),
                                      }
                                    });
                                  }}
                                >
                                  {periodScheds.map(sched => {
                                    const schedStart = timeToMinutes(sched.startTime);
                                    const schedEnd = timeToMinutes(sched.endTime);
                                    const effStart = Math.max(schedStart, periodStart);
                                    const effEnd = Math.min(schedEnd, periodEnd);
                                    const schedDuration = effEnd - effStart;
                                    const offset = effStart - periodStart;

                                    const widthPercent = (schedDuration / periodDuration) * 100;
                                    const leftPercent = (offset / periodDuration) * 100;

                                    const cardStyle: React.CSSProperties = {
                                      position: 'absolute',
                                      left: `${leftPercent}%`,
                                      width: `${widthPercent}%`,
                                      height: 'calc(100% - 4px)',
                                      top: '2px',
                                      backgroundColor: sched.subject?.color,
                                      zIndex: 10,
                                      borderRadius: 4,
                                      /* overflow: 'hidden', Removed to allow tooltip to pop out */
                                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                                      padding: '4px',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: '2px',
                                      border: '1px solid rgba(255,255,255,0.1)'
                                    };

                                    return (
                                      <div
                                        key={sched.id}
                                        className="cell-content"
                                        style={cardStyle}
                                        draggable={isAdmin && isEditMode}
                                        onDragStart={(e) => {
                                          if (!isAdmin || !isEditMode) return;
                                          e.stopPropagation();
                                          handleDragStart(e, 'move', { scheduleId: sched.id });
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setModalState({ open: true, mode: (isAdmin && isEditMode) ? 'edit' : 'read', schedule: sched });
                                        }}
                                      >
                                        {/* TOOLTIP ON HOVER */}
                                        <div className="cell-tooltip">
                                          <div className="tooltip-title">
                                            <div className="sidebar-dot" style={{ backgroundColor: sched.subject?.color }}></div>
                                            {sched.subject?.name}
                                          </div>
                                          <div className="tooltip-info">
                                            <div className="tooltip-label">Time</div>
                                            <div className="tooltip-value">{sched.startTime} - {sched.endTime}</div>

                                            <div className="tooltip-label">Year</div>
                                            <div className="tooltip-value">{yearGroups.find(y => y.id === sched.yearGroupId)?.name || 'All'}</div>

                                            <div className="tooltip-label">Teacher</div>
                                            <div className="tooltip-value">{sched.teacher?.name}</div>
                                          </div>

                                          {sched.studentSchedules && sched.studentSchedules.length > 0 && (
                                            <div className="tooltip-students-section">
                                              <div className="tooltip-label">Students ({sched.studentSchedules.length})</div>
                                              <div className="tooltip-students-list">
                                                {sched.studentSchedules.map(ss => (
                                                  <span key={ss.id} className="tooltip-student-item">{ss.student?.name}</span>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                        <div className="cell-subject" style={{ fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                          {sched.subject?.name}
                                        </div>
                                        <div className="cell-time" style={{ fontSize: '9px', opacity: 0.9 }}>
                                          {yearGroups.find(y => y.id === sched.yearGroupId)?.name || 'All'}
                                        </div>
                                        {sched.studentSchedules && sched.studentSchedules.length > 0 && widthPercent > 10 && (
                                          <div className="cell-students" style={{
                                            marginTop: 'auto',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '2px',
                                            overflow: 'hidden',
                                            width: '100%'
                                          }}>
                                            {sched.studentSchedules.slice(0, 3).map((ss) => (
                                              <span
                                                key={ss.id}
                                                style={{
                                                  fontSize: '7.5px',
                                                  background: 'rgba(0,0,0,0.25)',
                                                  padding: '1px 3px',
                                                  borderRadius: '2px',
                                                  whiteSpace: 'nowrap',
                                                  overflow: 'hidden',
                                                  textOverflow: 'ellipsis',
                                                  maxWidth: (sched.studentSchedules?.length || 0) > 1 ? '40%' : '100%',
                                                  flexShrink: 1
                                                }}
                                                title={ss.student?.name}
                                              >
                                                {ss.student?.name}
                                              </span>
                                            ))}
                                            {(sched.studentSchedules?.length || 0) > 3 && (
                                              <span style={{ fontSize: '7.5px', fontWeight: 'bold', flexShrink: 0 }}>
                                                +{(sched.studentSchedules?.length || 0) - 3}
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activePage === 'teachers' && (
          <TeachersPage
            teachers={teachers}
            schedules={schedules}
            isAdmin={isAdmin}
            onEdit={(t) => setTeacherModal({ open: true, mode: 'edit', teacher: t })}
            onDelete={(id) => confirmDelete('Delete Teacher', 'Are you sure you want to delete this teacher?', () => handleDeleteTeacher(id))}
            onAdd={() => setTeacherModal({ open: true, mode: 'create' })}
          />
        )}

        {activePage === 'subjects' && (
          <SubjectsPage
            subjects={subjects}
            schedules={schedules}
            isAdmin={isAdmin}
            onEdit={(s) => setSubjectModal({ open: true, mode: 'edit', subject: s })}
            onDelete={(id) => confirmDelete('Delete Subject', 'Are you sure you want to delete this subject?', () => handleDeleteSubject(id))}
            onAdd={() => setSubjectModal({ open: true, mode: 'create' })}
          />
        )}

        {activePage === 'students' && (
          <StudentsPage
            students={students}
            schedules={schedules}
            isAdmin={isAdmin}
            onAdd={handleAddStudent}
            onDelete={(id) => confirmDelete('Delete Student', 'Are you sure you want to delete this student?', () => handleDeleteStudent(id))}
          />
        )}
      </div>

      {/* SCHEDULE MODAL */}
      {
        modalState.open && (
          <ScheduleModal
            mode={modalState.mode}
            schedule={modalState.schedule}
            prefill={modalState.prefill}
            teachers={teachers}
            subjects={subjects}
            yearGroups={yearGroups}
            students={students}
            isAdmin={isAdmin}
            onSave={handleSaveSchedule}
            onDelete={handleDeleteSchedule}
            onAddStudent={handleAddStudent}
            onClose={() => setModalState({ open: false, mode: 'create' })}
          />
        )
      }

      {/* TEACHER MODAL */}
      {
        teacherModal.open && (
          <TeacherModal
            mode={teacherModal.mode}
            teacher={teacherModal.teacher}
            onSave={handleSaveTeacher}
            onDelete={handleDeleteTeacher}
            onClose={() => setTeacherModal({ open: false, mode: 'create' })}
          />
        )
      }

      {/* SUBJECT MODAL */}
      {
        subjectModal.open && (
          <SubjectModal
            mode={subjectModal.mode}
            subject={subjectModal.subject}
            onSave={handleSaveSubject}
            onDelete={handleDeleteSubject}
            onClose={() => setSubjectModal({ open: false, mode: 'create' })}
          />
        )
      }


      {/* CONFIRMATION MODAL */}
      {
        confirmationModal.open && (
          <div className="modal-overlay" onClick={() => setConfirmationModal(prev => ({ ...prev, open: false }))}>
            <div className="modal" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">{confirmationModal.title}</h2>
                <button className="modal-close" onClick={() => setConfirmationModal(prev => ({ ...prev, open: false }))}>×</button>
              </div>
              <div className="modal-body">
                <p style={{ marginBottom: 24, fontSize: 14, color: 'var(--text-secondary)' }}>{confirmationModal.message}</p>
                <div className="form-actions">
                  <button
                    className="btn btn-secondary"
                    onClick={() => setConfirmationModal(prev => ({ ...prev, open: false }))}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => {
                      confirmationModal.onConfirm();
                      setConfirmationModal(prev => ({ ...prev, open: false }));
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* TOAST */}
      {
        toast && toast.message && (
          <div className="toast-container">
            <div className={`toast toast-${toast.type || 'success'}`}>
              {toast.type === 'success' ? '✓' : '✗'} {toast.message}
            </div>
          </div>
        )
      }
    </div >
  );
}

// ===== SCHEDULE MODAL =====
function ScheduleModal({
  mode, schedule, prefill, teachers, subjects, yearGroups, students, isAdmin, onSave, onDelete, onAddStudent, onClose,
}: {
  mode: 'create' | 'edit' | 'read';
  schedule?: Schedule;
  prefill?: Partial<ScheduleFormData>;
  teachers: Teacher[];
  subjects: Subject[];
  yearGroups: YearGroup[];
  students: Student[];
  isAdmin: boolean;
  onSave: (data: ScheduleFormData, id?: string) => void;
  onDelete: (id: string) => void;
  onAddStudent: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [isAddingStudent, setIsAddingStudent] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [formData, setFormData] = useState<ScheduleFormData>({
    teacherId: schedule?.teacherId || prefill?.teacherId || teachers[0]?.id || '',
    subjectId: schedule?.subjectId || prefill?.subjectId || subjects[0]?.id || '',
    yearGroupId: schedule?.yearGroupId || prefill?.yearGroupId || '',
    dayOfWeek: schedule?.dayOfWeek ?? prefill?.dayOfWeek ?? 0,
    startTime: schedule?.startTime || prefill?.startTime || '07:30',
    endTime: schedule?.endTime || prefill?.endTime || '08:30',
    studentIds: schedule?.studentSchedules?.map(ss => ss.studentId) || prefill?.studentIds || [],
  });

  const filteredStudents = useMemo(() => {
    return students.filter(s => s.name.toLowerCase().includes(studentSearch.toLowerCase()));
  }, [students, studentSearch]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData, schedule?.id);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {mode === 'create' ? 'New Schedule' : mode === 'edit' ? 'Edit Schedule' : 'Schedule Details'}
          </h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Teacher</label>
            <select
              className="form-select"
              disabled={!isAdmin}
              value={formData.teacherId}
              onChange={e => setFormData({ ...formData, teacherId: e.target.value })}
            >
              {teachers.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Subject</label>
            <select
              className="form-select"
              disabled={!isAdmin}
              value={formData.subjectId}
              onChange={e => setFormData({ ...formData, subjectId: e.target.value })}
            >
              {subjects.map(s => (
                <option key={s.id} value={s.id}>{s.name} {s.type !== 'MAIN' ? `(${s.type})` : ''}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Year Group</label>
            <select
              className="form-select"
              disabled={!isAdmin}
              value={formData.yearGroupId || ''}
              onChange={e => setFormData({ ...formData, yearGroupId: e.target.value })}
            >
              <option value="">All</option>
              {yearGroups.map(yg => (
                <option key={yg.id} value={yg.id}>{yg.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Day</label>
            <select
              className="form-select"
              disabled={!isAdmin}
              value={formData.dayOfWeek}
              onChange={e => setFormData({ ...formData, dayOfWeek: parseInt(e.target.value) })}
            >
              {DAY_FULL_NAMES.map((day, i) => (
                <option key={i} value={i}>{day}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Start Time</label>
              <input
                type="time"
                className="form-input"
                disabled={!isAdmin}
                value={formData.startTime}
                onChange={e => setFormData({ ...formData, startTime: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">End Time</label>
              <input
                type="time"
                className="form-input"
                disabled={!isAdmin}
                value={formData.endTime}
                onChange={e => setFormData({ ...formData, endTime: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Assign Students</label>
              {isAdmin && (
                <button
                  type="button"
                  className="btn-add-new"
                  onClick={() => setIsAddingStudent(true)}
                >
                  <span style={{ fontSize: 16, marginRight: 4 }}>+</span> Add New Student
                </button>
              )}
            </div>

            {isAddingStudent && (
              <div className="add-student-inline">
                <input
                  className="form-input"
                  placeholder="Enter student name..."
                  value={newStudentName}
                  onChange={e => setNewStudentName(e.target.value)}
                  autoFocus
                  onKeyDown={async e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (newStudentName.trim()) {
                        await onAddStudent(newStudentName);
                        setNewStudentName('');
                        setIsAddingStudent(false);
                      }
                    } else if (e.key === 'Escape') {
                      setIsAddingStudent(false);
                      setNewStudentName('');
                    }
                  }}
                />
                <button type="button" className="btn btn-primary btn-sm" onClick={async () => {
                  if (newStudentName.trim()) {
                    await onAddStudent(newStudentName);
                    setNewStudentName('');
                    setIsAddingStudent(false);
                  }
                }}>Add</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
                  setIsAddingStudent(false);
                  setNewStudentName('');
                }}>Cancel</button>
              </div>
            )}

            {!isAddingStudent && students.length > 5 && (
              <input
                className="form-input"
                style={{ marginBottom: 8, fontSize: 13, padding: '6px 10px' }}
                placeholder="🔍 Search students..."
                value={studentSearch}
                onChange={e => setStudentSearch(e.target.value)}
              />
            )}

            <div className="student-tags-container" style={{ minHeight: students.length > 0 ? 100 : 120 }}>
              {students.length === 0 ? (
                <div className="empty-state">
                  <span style={{ fontSize: 20, marginBottom: 4 }}>👥</span>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No students available</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Click "Add New Student" to get started</div>
                </div>
              ) : filteredStudents.length === 0 ? (
                <div className="empty-state" style={{ padding: 12 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No students match "{studentSearch}"</div>
                </div>
              ) : (
                <div className="student-tags-grid">
                  {filteredStudents.map(s => {
                    const isSelected = formData.studentIds?.includes(s.id) || false;
                    return (
                      <div
                        key={s.id}
                        className={`student-tag-select ${isSelected ? 'selected' : ''} ${!isAdmin ? 'disabled' : ''}`}
                        onClick={() => {
                          if (!isAdmin) return;
                          const ids = formData.studentIds || [];
                          if (isSelected) {
                            setFormData({ ...formData, studentIds: ids.filter(id => id !== s.id) });
                          } else {
                            setFormData({ ...formData, studentIds: [...ids, s.id] });
                          }
                        }}
                      >
                        <span className="student-tag-name">{s.name}</span>
                        {isSelected && <span className="student-tag-check">✓</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="form-actions">
            {mode === 'edit' && schedule && isAdmin && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => onDelete(schedule.id)}
              >
                Delete
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {isAdmin ? 'Cancel' : 'Close'}
            </button>
            {isAdmin && (
              <button type="submit" className="btn btn-primary">
                {mode === 'create' ? 'Create' : 'Save'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== TEACHERS PAGE =====
function TeachersPage({
  teachers, schedules, isAdmin, onEdit, onDelete, onAdd,
}: {
  teachers: Teacher[];
  schedules: Schedule[];
  isAdmin: boolean;
  onEdit: (t: Teacher) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Teachers</h1>
        {isAdmin && <button className="btn btn-primary" onClick={onAdd}>+ Add Teacher</button>}
      </div>
      <div className="card-grid">
        {teachers.map(teacher => (
          <div key={teacher.id} className="card">
            <div className="card-header">
              <div className="card-name">
                <div className="sidebar-dot" style={{ backgroundColor: teacher.color, width: 14, height: 14 }}></div>
                {teacher.name}
              </div>
              {isAdmin && (
                <div className="card-actions">
                  <button className="card-action-btn" onClick={() => onEdit(teacher)}>✎</button>
                  <button className="card-action-btn delete" onClick={(e) => {
                    e.stopPropagation();
                    onDelete(teacher.id);
                  }}>🗑</button>
                </div>
              )}
            </div>
            <div className="card-meta">{teacher.email}</div>
            <div className="card-meta" style={{ marginTop: 8, color: '#818cf8', fontWeight: 500 }}>
              📅 Total: {calculateTeacherHours(schedules, teacher.id)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== TEACHER MODAL =====
function TeacherModal({
  mode, teacher, onSave, onDelete, onClose,
}: {
  mode: 'create' | 'edit';
  teacher?: Teacher;
  onSave: (data: { name: string; email: string; color: string }, id?: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(teacher?.name || '');
  const [email, setEmail] = useState(teacher?.email || '');
  const [color, setColor] = useState(teacher?.color || TEACHER_COLORS[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, email, color }, teacher?.id);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{mode === 'create' ? 'Add Teacher' : 'Edit Teacher'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Teacher name"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="teacher@school.edu"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Color</label>
            <div className="color-picker-row">
              {TEACHER_COLORS.map(c => (
                <div
                  key={c}
                  className={`color-swatch ${color === c ? 'selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="form-actions">
            {mode === 'edit' && teacher && (
              <button type="button" className="btn btn-danger" onClick={() => { if (confirm('Delete this teacher?')) onDelete(teacher.id); }}>
                Delete
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {mode === 'create' ? 'Add' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== SUBJECTS PAGE =====
function SubjectsPage({
  subjects, schedules, isAdmin, onEdit, onDelete, onAdd,
}: {
  subjects: Subject[];
  schedules: Schedule[];
  isAdmin: boolean;
  onEdit: (s: Subject) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  const groupedSubjects: Record<string, Subject[]> = {};
  subjects.forEach(s => {
    const t = s.type || 'MAIN';
    if (!groupedSubjects[t]) groupedSubjects[t] = [];
    groupedSubjects[t].push(s);
  });

  const getSubjectClassCount = (subjectId: string) => {
    return schedules.filter(s => s.subjectId === subjectId).length;
  };

  // Sort types: MAIN, INTERVENTION, BOOSTER first, then alphabetical
  const types = Object.keys(groupedSubjects).sort((a, b) => {
    const order = ['MAIN', 'INTERVENTION', 'BOOSTER'];
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Subjects</h1>
        {isAdmin && <button className="btn btn-primary" onClick={onAdd}>+ Add Subject</button>}
      </div>

      {types.map(type => (
        <div key={type} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`badge badge-${type.toLowerCase()}`} style={{ textTransform: 'uppercase' }}>{type}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 500, marginLeft: 4 }}>
              ({groupedSubjects[type].length} subjects)
            </span>
          </h2>
          <div className="card-grid">
            {groupedSubjects[type].map(subject => (
              <div key={subject.id} className="card">
                <div className="card-header">
                  <div className="card-name">
                    <div className="sidebar-dot" style={{ backgroundColor: subject.color, width: 14, height: 14 }}></div>
                    {subject.name}
                  </div>
                  {isAdmin && (
                    <div className="card-actions">
                      <button className="card-action-btn" onClick={() => onEdit(subject)}>✎</button>
                      <button className="card-action-btn delete" onClick={(e) => {
                        e.stopPropagation();
                        onDelete(subject.id);
                      }}>🗑</button>
                    </div>
                  )}
                </div>
                <div className="card-meta" style={{ marginTop: 8, color: '#818cf8', fontWeight: 500 }}>
                  📚 {getSubjectClassCount(subject.id)} scheduled classes
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ===== SUBJECT MODAL =====
function SubjectModal({
  mode, subject, onSave, onDelete, onClose,
}: {
  mode: 'create' | 'edit';
  subject?: Subject;
  onSave: (data: { name: string; color: string; type: string }, id?: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(subject?.name || '');
  const [color, setColor] = useState(subject?.color || SUBJECT_COLORS[0]);
  const [type, setType] = useState<string>(subject?.type || 'MAIN');
  const [isAddingType, setIsAddingType] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, color, type }, subject?.id);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{mode === 'create' ? 'Add Subject' : 'Edit Subject'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              type="text"
              className="form-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Subject name"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Type</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {isAddingType ? (
                <>
                  <input
                    type="text"
                    className="form-input"
                    value={type}
                    onChange={e => setType(e.target.value)}
                    placeholder="Enter new type"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0 12px' }}
                    onClick={() => {
                      setIsAddingType(false);
                      setType(subject?.type || 'MAIN');
                    }}
                  >Cancel</button>
                </>
              ) : (
                <>
                  <select
                    className="form-select"
                    value={type}
                    onChange={e => setType(e.target.value)}
                  >
                    {['MAIN', 'INTERVENTION', 'BOOSTER'].map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                    {/* If current type is custom, show it as option */}
                    {!['MAIN', 'INTERVENTION', 'BOOSTER'].includes(type) && (
                      <option value={type}>{type}</option>
                    )}
                  </select>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: '0 12px', minWidth: '40px' }}
                    onClick={() => {
                      setIsAddingType(true);
                      setType('');
                    }}
                    title="Add new type"
                  >+</button>
                </>
              )}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Color</label>
            <div className="color-picker-row">
              {SUBJECT_COLORS.map(c => (
                <div
                  key={c}
                  className={`color-swatch ${color === c ? 'selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="form-actions">
            {mode === 'edit' && subject && (
              <button type="button" className="btn btn-danger" onClick={() => { if (confirm('Delete this subject?')) onDelete(subject.id); }}>
                Delete
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {mode === 'create' ? 'Add' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== STUDENTS PAGE =====
function StudentsPage({ students, schedules, isAdmin, onAdd, onDelete }: { students: Student[], schedules: Schedule[], isAdmin: boolean, onAdd: (name: string) => void, onDelete: (id: string) => void }) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(newName);
    setNewName('');
    setIsModalOpen(false);
  };

  const getStudentClassCount = (studentId: string) => {
    return schedules.filter(s => s.studentSchedules?.some(ss => ss.studentId === studentId)).length;
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Students</h1>
        {isAdmin && <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>+ Add Student</button>}
      </div>
      <div className="card-grid">
        {students.map(s => (
          <div key={s.id} className="card">
            <div className="card-header">
              <div className="card-name">
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16
                }}>👤</div>
                {s.name}
              </div>
              {isAdmin && (
                <button className="card-action-btn delete" onClick={() => {
                  onDelete(s.id);
                }}>🗑</button>
              )}
            </div>
            <div className="card-meta" style={{ marginTop: 8, color: '#818cf8', fontWeight: 500 }}>
              📚 Assigned to {getStudentClassCount(s.id)} classes
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Add Student</h2>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>×</button>
            </div>
            <form className="modal-body" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" value={newName} onChange={e => setNewName(e.target.value)} required autoFocus placeholder="Student Name" />
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add Student</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
