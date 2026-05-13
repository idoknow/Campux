import { useEffect, useMemo, useState } from "react";
import type { TenantSummary } from "@campux/domain";
import { api, fileToBase64 } from "@/lib/api";
import { canAccess, defaultMetadata, navItems } from "@/lib/app-model";
import type { AuthenticatedMe, MainTab, MeResponse, PostItem, TenantMetadata, UploadedImage } from "@/types/app";
import { LoadingScreen } from "@/features/auth/LoadingScreen";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { TenantSelectionScreen } from "@/features/auth/TenantSelectionScreen";
import { OpsStandaloneScreen } from "@/features/ops/OpsStandaloneScreen";
import { AppShell } from "@/features/shell/AppShell";

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [activeTab, setActiveTab] = useState<MainTab>("post");
  const [metadata, setMetadata] = useState<TenantMetadata>(defaultMetadata);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [postText, setPostText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [showOpsOnly, setShowOpsOnly] = useState(false);

  const selectedTenant = me?.authenticated ? me.currentTenant : tenants[0];
  const currentRole = me?.authenticated ? me.currentMembership?.role : undefined;
  const availableNavItems = useMemo(() => {
    if (!currentRole) {
      return navItems.filter((item) => item.value !== "admin");
    }
    return navItems.filter((item) => canAccess(currentRole, item.minRole));
  }, [currentRole]);

  async function refreshMe() {
    const data = await api<MeResponse>("/api/me");
    setMe(data);
  }

  async function refreshTenantData() {
    if (!me?.authenticated || !me.currentTenant) {
      return;
    }

    const [metadataData, postsData] = await Promise.all([
      api<TenantMetadata>("/api/tenant/metadata"),
      api<{ posts: PostItem[] }>("/api/posts/mine"),
    ]);
    setMetadata(metadataData);
    setPosts(postsData.posts);
  }

  useEffect(() => {
    let ignore = false;
    async function boot() {
      try {
        const [meData, tenantData] = await Promise.all([
          api<MeResponse>("/api/me"),
          api<{ tenants: TenantSummary[] }>("/api/tenants"),
        ]);
        if (!ignore) {
          setMe(meData);
          setTenants(tenantData.tenants);
        }
      } catch (caught) {
        if (!ignore) {
          setError(caught instanceof Error ? caught.message : "无法连接到 Campux API");
          setMe({ authenticated: false });
        }
      }
    }

    void boot();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    void refreshTenantData().catch((caught) => {
      setError(caught instanceof Error ? caught.message : "无法读取校园墙数据");
    });
  }, [me]);

  useEffect(() => {
    if (!availableNavItems.some((item) => item.value === activeTab)) {
      setActiveTab(availableNavItems[0]?.value ?? "post");
    }
  }, [activeTab, availableNavItems]);

  async function login(qqUin: string, password: string) {
    setError("");
    const data = await api<MeResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ qqUin, password }),
    });
    setMe(data);
  }

  async function logout() {
    await api<{ ok: true }>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setMe({ authenticated: false });
    setPostText("");
    setUploadedImages([]);
    setPosts([]);
    setActiveTab("post");
    setShowOpsOnly(false);
  }

  async function selectTenant(tenantId: string) {
    await api("/api/session/tenant", {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    });
    await refreshMe();
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setBusy(true);
    setError("");
    try {
      const nextImages: UploadedImage[] = [];
      for (const file of Array.from(files).slice(0, 9 - uploadedImages.length)) {
        const previewUrl = await fileToBase64(file);
        const uploaded = await api<Omit<UploadedImage, "previewUrl">>("/api/uploads/post-images", {
          method: "POST",
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            base64: previewUrl,
          }),
        });
        nextImages.push({ ...uploaded, previewUrl });
      }
      setUploadedImages((current) => [...current, ...nextImages]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "图片上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitPost() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api("/api/posts", {
        method: "POST",
        body: JSON.stringify({
          text: postText,
          anonymous,
          images: uploadedImages.map(({ key, url, fileName }) => ({ key, url, fileName })),
        }),
      });
      setPostText("");
      setUploadedImages([]);
      setAnonymous(false);
      setNotice("投稿已提交，等待审核。");
      const data = await api<{ posts: PostItem[] }>("/api/posts/mine");
      setPosts(data.posts);
      setActiveTab("posts");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "投稿失败");
    } finally {
      setBusy(false);
    }
  }

  if (!me) {
    return <LoadingScreen />;
  }

  if (!me.authenticated) {
    return <LoginScreen selectedTenant={selectedTenant ?? undefined} error={error} onLogin={login} />;
  }

  if (me.user.systemRole === "system_operator" && (showOpsOnly || me.memberships.length === 0)) {
    if (me.memberships.length > 0) {
      return <OpsStandaloneScreen me={me} onBackToTenants={() => setShowOpsOnly(false)} onLogout={logout} />;
    }

    return <OpsStandaloneScreen me={me} onLogout={logout} />;
  }

  if (me.needsTenantSelection || !me.currentTenant || !me.currentMembership) {
    if (me.user.systemRole === "system_operator") {
      return <TenantSelectionScreen me={me} onSelectTenant={selectTenant} onOpenOps={() => setShowOpsOnly(true)} onLogout={logout} />;
    }

    return (
      <TenantSelectionScreen
        me={me}
        onSelectTenant={selectTenant}
        onLogout={logout}
      />
    );
  }

  return (
    <AppShell
      activeTab={activeTab}
      me={me as AuthenticatedMe & { currentTenant: NonNullable<AuthenticatedMe["currentTenant"]>; currentMembership: NonNullable<AuthenticatedMe["currentMembership"]> }}
      navItems={availableNavItems}
      metadata={metadata}
      posts={posts}
      busy={busy}
      error={error}
      notice={notice}
      postText={postText}
      anonymous={anonymous}
      uploadedImages={uploadedImages}
      onActiveTabChange={setActiveTab}
      onAnonymousChange={setAnonymous}
      onFilesSelected={uploadFiles}
      onLogout={logout}
      onOpenOps={me.user.systemRole === "system_operator" ? () => setShowOpsOnly(true) : undefined}
      onPostTextChange={setPostText}
      onRefreshMe={refreshMe}
      onRefreshTenantData={refreshTenantData}
      onRemoveImage={(key) => setUploadedImages((current) => current.filter((image) => image.key !== key))}
      onSubmitPost={submitPost}
    />
  );
}
