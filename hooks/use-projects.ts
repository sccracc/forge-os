"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { subscribeProjects, subscribeProject } from "@/lib/data/projects";
import { subscribeProjectFiles } from "@/lib/data/files";
import type { ProjectDoc, FileDoc } from "@/lib/data/types";

export function useProjects() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeProjects(
      user.uid,
      (p) => {
        setProjects(p);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [user]);
  return { projects, loading };
}

export function useProject(projectId: string | null) {
  const { user } = useAuth();
  const [project, setProject] = useState<ProjectDoc | null>(null);
  useEffect(() => {
    if (!user || !projectId) {
      setProject(null);
      return;
    }
    return subscribeProject(user.uid, projectId, setProject);
  }, [user, projectId]);
  return project;
}

export function useProjectFiles(projectId: string | null) {
  const { user } = useAuth();
  const [files, setFiles] = useState<FileDoc[]>([]);
  const [loading, setLoading] = useState(Boolean(projectId));
  useEffect(() => {
    if (!user || !projectId) {
      setFiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeProjectFiles(user.uid, projectId, (f) => {
      setFiles(f);
      setLoading(false);
    });
  }, [user, projectId]);
  return { files, loading };
}
