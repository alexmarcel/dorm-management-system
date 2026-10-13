"use client";
import { useCallback, useEffect, useState } from "react";
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json();
  if (res.status === 401 && path !== "login")
    window.dispatchEvent(new Event("paini:expired"));
  if (!res.ok) throw new Error(data.code || data.error || "Request failed.");
  return data;
}
export function useData<T>(path: string, refreshMs = 30000) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const value = await api<T>(path);
      setData(value);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    const load = async () => {
      try {
        const value = await api<T>(path);
        if (active) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, refreshMs);
    window.addEventListener("focus", load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [path, refreshMs]);
  return { data, error, refresh, setData };
}
export async function compress(file: File): Promise<Blob> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Use JPEG, PNG, or WebP photos up to 20 MB each.");
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
      quality = 0.8;
    for (let attempt = 0; attempt < 24; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas
        .getContext("2d")!
        .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      if (!blob || blob.type !== "image/webp")
        throw new Error(
          "This browser cannot compress WebP photos. Please use a current browser.",
        );
      if (blob.size <= 500000) return blob;
      if (quality > 0.45) quality -= 0.1;
      else scale *= 0.8;
    }
    throw new Error("Could not compress this photo. Choose another image.");
  } finally {
    bitmap.close();
  }
}
