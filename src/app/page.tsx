'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  { id: 'b2', label: '13:10 - 13:15', start: '13:10', end: '13:15', isBreak: true },
  { id: 'p6', label: '13:15 - 14:15', start: '13:15', end: '14:15', display: '6' },
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
    mode: 'create' | 'edit';
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

  const confirmDelete = (title: string, message: string, onConfirm: () => void) => {
    setConfirmationModal({ open: true, title, message, onConfirm });
  };

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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
        fetch('/api/teachers'),
        fetch('/api/subjects'),
        fetch('/api/year-groups'),
        fetch('/api/students'),
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
      const res = await fetch('/api/schedules');
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


  // Schedule CRUD
  const handleSaveSchedule = async (data: ScheduleFormData, id?: string) => {
    try {
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/schedules/${id}` : '/api/schedules';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error();
      await fetchSchedules();
      setModalState({ open: false, mode: 'create' });
      showToast(id ? 'Schedule updated' : 'Schedule created');
    } catch {
      showToast('Failed to save schedule', 'error');
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

    // Check if target slot is occupied
    const targetSchedule = schedules.find(s =>
      s.teacherId === targetTeacherId &&
      s.dayOfWeek === targetDay &&
      (!selectedYearGroup || s.yearGroupId === selectedYearGroup) &&
      isScheduleInPeriod(s, period.start, period.end)
    );

    try {
      if (type === 'create') {
        const subjectId = data.subjectId;
        // Logic: If occupied, Replace (Delete old, Create new). If empty, Create new.
        if (targetSchedule) {
          await fetch(`/api/schedules/${targetSchedule.id}`, { method: 'DELETE' });
        }

        await handleSaveSchedule({
          teacherId: targetTeacherId,
          subjectId,
          yearGroupId: targetYearGroupId,
          dayOfWeek: targetDay,
          startTime: period.start,
          endTime: period.end
        });

      } else if (type === 'move') {
        const sourceScheduleId = data.scheduleId;
        const sourceSchedule = schedules.find(s => s.id === sourceScheduleId);
        if (!sourceSchedule) return;

        // Verify we aren't dropping on self
        if (targetSchedule && targetSchedule.id === sourceSchedule.id) return;

        if (targetSchedule) {
          // SWAP Logic
          // Store Source Coords
          const sourceCoords = {
            teacherId: sourceSchedule.teacherId,
            dayOfWeek: sourceSchedule.dayOfWeek,
            startTime: sourceSchedule.startTime,
            endTime: sourceSchedule.endTime
          };

          // Update Source to Target Coords
          await handleSaveSchedule({
            ...sourceSchedule,
            teacherId: targetTeacherId,
            dayOfWeek: targetDay,
            startTime: period.start,
            endTime: period.end,
            subjectId: sourceSchedule.subjectId,
            yearGroupId: sourceSchedule.yearGroupId
          }, sourceSchedule.id);

          // Update Target to Source Coords
          await handleSaveSchedule({
            ...targetSchedule,
            ...sourceCoords,
            subjectId: targetSchedule.subjectId,
            yearGroupId: targetSchedule.yearGroupId
          }, targetSchedule.id);

          showToast('Schedules switched');

        } else {
          // MOVE Logic (Target Empty)
          await handleSaveSchedule({
            ...sourceSchedule,
            teacherId: targetTeacherId,
            dayOfWeek: targetDay,
            startTime: period.start,
            endTime: period.end,
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
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await fetchSchedules();
      setModalState({ open: false, mode: 'create' });
      showToast('Schedule deleted');
    } catch {
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
      {/* SIDEBAR */}
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">ST</div>
          {!isSidebarCollapsed && <span className="sidebar-title">Timetable</span>}
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
            {subjects
              .filter(s => s.name.toLowerCase().includes(subjectFilter.toLowerCase()))
              .filter(s => s.type === 'MAIN').map(subject => (
                <div
                  key={subject.id}
                  className={`sidebar-item ${selectedSubjectIds.has(subject.id) ? 'active' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, 'create', { subjectId: subject.id })}
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
                    justifyContent: isSidebarCollapsed ? 'center' : 'flex-start'
                  }}
                  title={subject.name}
                >
                  <div className="sidebar-dot" style={{ backgroundColor: subject.color }}></div>
                  {!isSidebarCollapsed && <span className="sidebar-item-text">{subject.name}</span>}
                </div>
              ))}
            {subjects
              .filter(s => s.name.toLowerCase().includes(subjectFilter.toLowerCase()))
              .filter(s => s.type !== 'MAIN').map(subject => (
                <div
                  key={subject.id}
                  className={`sidebar-item ${selectedSubjectIds.has(subject.id) ? 'active' : ''}`}
                  draggable
                  onDragStart={(e) => handleDragStart(e, 'create', { subjectId: subject.id })}
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
                    justifyContent: isSidebarCollapsed ? 'center' : 'flex-start'
                  }}
                  title={subject.name}
                >
                  <div className="sidebar-dot" style={{ backgroundColor: subject.color, border: '2px dashed rgba(255,255,255,0.3)' }}></div>
                  {!isSidebarCollapsed && <span className="sidebar-item-text">{subject.name}</span>}
                </div>
              ))}
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
          <div className="topnav-links">
            <a className={`topnav-link ${activePage === 'calendar' ? 'active' : ''}`} onClick={() => setActivePage('calendar')}>Calendar</a>
            <a className={`topnav-link ${activePage === 'teachers' ? 'active' : ''}`} onClick={() => setActivePage('teachers')}>Teachers</a>
            <a className={`topnav-link ${activePage === 'subjects' ? 'active' : ''}`} onClick={() => setActivePage('subjects')}>Subjects</a>
            <a className={`topnav-link ${activePage === 'students' ? 'active' : ''}`} onClick={() => setActivePage('students')}>Students</a>
          </div>
          <div className="topnav-right">
            <div className="topnav-avatar">A</div>
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
              position: 'sticky', top: 0, zIndex: 10 // Sticky header
            }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>Filter by Year:</span>
              <select
                className="form-select"
                style={{ width: 'auto', padding: '6px 12px', fontSize: 13, borderColor: 'var(--border-primary)' }}
                value={selectedYearGroup}
                onChange={(e) => setSelectedYearGroup(e.target.value)}
              >
                <option value="">All Years</option>
                {yearGroups.map(yg => (
                  <option key={yg.id} value={yg.id}>{yg.name}</option>
                ))}
              </select>
            </div>

            {/* TEACHER MATRIX */}
            <div className="timetable-matrix">
              {/* Main Header (Periods) */}
              <div className="matrix-header-row">
                <div className="header-cell col-day">Day</div>
                <div className="header-cell col-teacher">Teacher</div>
                {TIME_PERIODS.map(p => (
                  <div key={p.id} className={`header-cell col-period ${p.isBreak ? 'is-break' : ''} ${p.id === 'hr' ? 'is-hr' : ''}`}>
                    <div className="header-period-top">
                      <div className="header-time">
                        {['b1', 'b2', 'end'].includes(p.id) ? (
                          <>
                            <span>{p.start}</span>
                            <div style={{ width: '100%', height: 0 }}></div>
                            <span>- {p.end}</span>
                          </>
                        ) : (
                          <span>{p.start} - {p.end}</span>
                        )}
                      </div>
                    </div>
                    <div className="header-period-bottom">
                      {p.display || ''}
                    </div>
                  </div>
                ))}
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
                      (!selectedYearGroup || s.yearGroupId === selectedYearGroup) &&
                      selectedSubjectIds.has(s.subjectId)
                    );
                    return hasMatchingSchedule;
                  })
                  .sort((a, b) => a.name.localeCompare(b.name));

                if (currentTeachers.length === 0) return null;

                return (
                  <div key={dayIdx} className="day-group">
                    {/* Day Label Column */}
                    <div className="day-label-col">
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
                          (!selectedYearGroup || s.yearGroupId === selectedYearGroup) &&
                          (selectedSubjectIds.size === 0 || selectedSubjectIds.has(s.subjectId))
                        );

                        return (
                          <div key={teacher.id} className="teacher-row">
                            <div className="teacher-name-cell">
                              <span className="teacher-dot" style={{ backgroundColor: teacher.color }}></span>
                              {teacher.name}
                            </div>

                            {/* Period Cells */}
                            {TIME_PERIODS.map(period => {
                              const periodScheds = rowSchedules.filter(s => isScheduleInPeriod(s, period.start, period.end));
                              const isBusy = periodScheds.length > 0;
                              const sched = periodScheds[0];

                              return (
                                <div
                                  key={period.id}
                                  className={`period-cell ${isBusy ? 'busy' : ''} ${period.isBreak ? 'break' : ''} ${period.id === 'hr' ? 'is-hr' : ''}`}
                                  style={isBusy ? { backgroundColor: sched.subject?.color } : {}}

                                  // Drag Source (if busy)
                                  draggable={isBusy}
                                  onDragStart={(e) => {
                                    if (isBusy) handleDragStart(e, 'move', { scheduleId: sched.id });
                                  }}

                                  // Drop Target
                                  onDragOver={handleDragOver}
                                  onDrop={(e) => handleDrop(e, teacher.id, dayIdx, period)}

                                  onClick={() => {
                                    if (isBusy) {
                                      setModalState({ open: true, mode: 'edit', schedule: sched });
                                    } else {
                                      setModalState({
                                        open: true, mode: 'create', prefill: {
                                          teacherId: teacher.id,
                                          dayOfWeek: dayIdx,
                                          startTime: period.start,
                                          endTime: period.end,
                                          yearGroupId: selectedYearGroup || (yearGroups.length > 0 ? yearGroups[0].id : ''),
                                        }
                                      });
                                    }
                                  }}
                                >
                                  {isBusy && (
                                    <div className="cell-content">
                                      <div className="cell-subject">{sched.subject?.name}</div>
                                      <div className="cell-time">{yearGroups.find(y => y.id === sched.yearGroupId)?.name || sched.yearGroupId}</div>
                                      {sched.studentSchedules && sched.studentSchedules.length > 0 && (
                                        <div className="cell-students">
                                          {sched.studentSchedules.slice(0, 3).map(ss => (
                                            <span key={ss.id} className="student-tag">{ss.student?.name}</span>
                                          ))}
                                          {sched.studentSchedules.length > 3 && (
                                            <span className="student-tag-more">+{sched.studentSchedules.length - 3}</span>
                                          )}
                                        </div>
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
            onEdit={(t) => setTeacherModal({ open: true, mode: 'edit', teacher: t })}
            onDelete={(id) => confirmDelete('Delete Teacher', 'Are you sure you want to delete this teacher?', () => handleDeleteTeacher(id))}
            onAdd={() => setTeacherModal({ open: true, mode: 'create' })}
          />
        )}

        {activePage === 'subjects' && (
          <SubjectsPage
            subjects={subjects}
            schedules={schedules}
            onEdit={(s) => setSubjectModal({ open: true, mode: 'edit', subject: s })}
            onDelete={(id) => confirmDelete('Delete Subject', 'Are you sure you want to delete this subject?', () => handleDeleteSubject(id))}
            onAdd={() => setSubjectModal({ open: true, mode: 'create' })}
          />
        )}

        {activePage === 'students' && (
          <StudentsPage
            students={students}
            schedules={schedules}
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
  mode, schedule, prefill, teachers, subjects, yearGroups, students, onSave, onDelete, onAddStudent, onClose,
}: {
  mode: 'create' | 'edit';
  schedule?: Schedule;
  prefill?: Partial<ScheduleFormData>;
  teachers: Teacher[];
  subjects: Subject[];
  yearGroups: YearGroup[];
  students: Student[];
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
    yearGroupId: schedule?.yearGroupId || prefill?.yearGroupId || yearGroups[0]?.id || '',
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
          <h2 className="modal-title">{mode === 'create' ? 'New Schedule' : 'Edit Schedule'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Teacher</label>
            <select
              className="form-select"
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
              value={formData.yearGroupId}
              onChange={e => setFormData({ ...formData, yearGroupId: e.target.value })}
            >
              {yearGroups.map(yg => (
                <option key={yg.id} value={yg.id}>{yg.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Day</label>
            <select
              className="form-select"
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
                value={formData.startTime}
                onChange={e => setFormData({ ...formData, startTime: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">End Time</label>
              <input
                type="time"
                className="form-input"
                value={formData.endTime}
                onChange={e => setFormData({ ...formData, endTime: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Assign Students</label>
              <button
                type="button"
                className="btn-add-new"
                onClick={() => setIsAddingStudent(true)}
              >
                <span style={{ fontSize: 16, marginRight: 4 }}>+</span> Add New Student
              </button>
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
                        className={`student-tag-select ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
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
            {mode === 'edit' && schedule && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => onDelete(schedule.id)}
              >
                Delete
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">
              {mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== TEACHERS PAGE =====
function TeachersPage({
  teachers, schedules, onEdit, onDelete, onAdd,
}: {
  teachers: Teacher[];
  schedules: Schedule[];
  onEdit: (t: Teacher) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Teachers</h1>
        <button className="btn btn-primary" onClick={onAdd}>+ Add Teacher</button>
      </div>
      <div className="card-grid">
        {teachers.map(teacher => (
          <div key={teacher.id} className="card">
            <div className="card-header">
              <div className="card-name">
                <div className="sidebar-dot" style={{ backgroundColor: teacher.color, width: 14, height: 14 }}></div>
                {teacher.name}
              </div>
              <div className="card-actions">
                <button className="card-action-btn" onClick={() => onEdit(teacher)}>✎</button>
                <button className="card-action-btn delete" onClick={(e) => {
                  e.stopPropagation();
                  onDelete(teacher.id);
                }}>🗑</button>
              </div>
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
  subjects, schedules, onEdit, onDelete, onAdd,
}: {
  subjects: Subject[];
  schedules: Schedule[];
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
        <button className="btn btn-primary" onClick={onAdd}>+ Add Subject</button>
      </div>

      {types.map(type => (
        <div key={type} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`badge badge-${type.toLowerCase()}`} style={{ textTransform: 'uppercase' }}>{type}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
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
                  <div className="card-actions">
                    <button className="card-action-btn" onClick={() => onEdit(subject)}>✎</button>
                    <button className="card-action-btn delete" onClick={(e) => {
                      e.stopPropagation();
                      onDelete(subject.id);
                    }}>🗑</button>
                  </div>
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
function StudentsPage({ students, schedules, onAdd, onDelete }: { students: Student[], schedules: Schedule[], onAdd: (name: string) => void, onDelete: (id: string) => void }) {
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
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>+ Add Student</button>
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
              <button className="card-action-btn delete" onClick={() => {
                onDelete(s.id);
              }}>🗑</button>
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
