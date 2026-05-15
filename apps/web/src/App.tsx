import { useEffect, useMemo, useState } from "react";
import type { TenantSummary } from "@campux/domain";
import { toast } from "sonner";
import { api, fileToBase64 } from "@/lib/api";
import { canAccess, defaultMetadata, navItems } from "@/lib/app-model";
import type { AdminTab, AuthenticatedMe, MainTab, MeResponse, Pagination, PostItem, PostsTab, TenantMetadata, UploadedImage } from "@/types/app";
import { LoadingScreen } from "@/features/auth/LoadingScreen";
import { LoginScreen } from "@/features/auth/LoginScreen";
import { BannedScreen } from "@/features/auth/BannedScreen";
import { TenantSelectionScreen } from "@/features/auth/TenantSelectionScreen";
import { OpsStandaloneScreen } from "@/features/ops/OpsStandaloneScreen";
import { AppShell } from "@/features/shell/AppShell";

type AppRoute =
  | { kind: "tenant"; tab: MainTab; subTab?: AdminTab | PostsTab }
  | { kind: "login" | "tenants" | "ops" };

const tabPaths: Record<MainTab, string> = {
  post: "/post",
  posts: "/posts",
  services: "/services",
  admin: "/admin",
};

const postsTabPaths: Record<PostsTab, string> = {
  mine: "/posts",
  review: "/posts/review",
};

const adminTabPaths: Record<AdminTab, string> = {
  users: "/admin",
  bans: "/admin/bans",
  metadata: "/admin/metadata",
  bots: "/admin/bots",
  publish: "/admin/publish",
};

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [route, setRoute] = useState<AppRoute>(() => routeFromPath(window.location.pathname));
  const [activeTab, setActiveTabState] = useState<MainTab>(() => {
    const initialRoute = routeFromPath(window.location.pathname);
    return initialRoute.kind === "tenant" ? initialRoute.tab : "post";
  });
  const [metadata, setMetadata] = useState<TenantMetadata>(defaultMetadata);
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [postsPagination, setPostsPagination] = useState<Pagination>(() => defaultPagination());
  const [postsPage, setPostsPage] = useState(1);
  const [tenantDataLoading, setTenantDataLoading] = useState(false);
  const [postText, setPostText] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  function navigate(nextRoute: AppRoute, mode: "push" | "replace" = "push") {
    const path = pathFromRoute(nextRoute);
    if (window.location.pathname !== path) {
      window.history[mode === "replace" ? "replaceState" : "pushState"](null, "", path);
    }
    setRoute(nextRoute);
    if (nextRoute.kind === "tenant") {
      setActiveTabState(nextRoute.tab);
    }
  }

  function setActiveTab(tab: MainTab) {
    navigate({ kind: "tenant", tab });
  }

  function setPostsSubTab(tab: PostsTab) {
    navigate({ kind: "tenant", tab: "posts", subTab: tab });
  }

  function setAdminSubTab(tab: AdminTab) {
    navigate({ kind: "tenant", tab: "admin", subTab: tab });
  }

  async function refreshTenantData(page = postsPage) {
    if (!me?.authenticated || !me.currentTenant || me.activeBan) {
      return;
    }

    setTenantDataLoading(true);
    try {
      const [metadataData, postsData] = await Promise.all([
        api<TenantMetadata>("/api/tenant/metadata"),
        api<{ posts: PostItem[]; pagination: Pagination }>(`/api/posts/mine?page=${page}&limit=${postsPagination.limit}`),
      ]);
      setMetadata(metadataData);
      setPosts(postsData.posts);
      setPostsPagination(postsData.pagination);
      setPostsPage(postsData.pagination.page);
    } finally {
      setTenantDataLoading(false);
    }
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
    const syncRoute = () => {
      const nextRoute = routeFromPath(window.location.pathname);
      setRoute(nextRoute);
      if (nextRoute.kind === "tenant") {
        setActiveTabState(nextRoute.tab);
      }
    };
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    void refreshTenantData().catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取校园墙数据");
    });
  }, [me]);

  useEffect(() => {
    if (!me?.authenticated || !me.currentTenant || me.activeBan) {
      return;
    }
    void refreshTenantData(postsPage).catch((caught) => {
      toast.error(caught instanceof Error ? caught.message : "无法读取稿件列表");
    });
  }, [postsPage]);

  useEffect(() => {
    if (!me?.authenticated || !me.currentMembership) {
      return;
    }

    if (!availableNavItems.some((item) => item.value === activeTab)) {
      setActiveTab(availableNavItems[0]?.value ?? "post");
    }
  }, [activeTab, availableNavItems, me]);

  useEffect(() => {
    if (!me) {
      return;
    }

    if (!me.authenticated) {
      if (route.kind !== "login") {
        navigate({ kind: "login" }, "replace");
      }
      return;
    }

    if (route.kind === "login") {
      navigate(me.needsTenantSelection || !me.currentTenant ? { kind: "tenants" } : { kind: "tenant", tab: activeTab }, "replace");
      return;
    }

    if (route.kind === "ops" && me.user.systemRole !== "system_operator") {
      navigate(me.needsTenantSelection || !me.currentTenant ? { kind: "tenants" } : { kind: "tenant", tab: activeTab }, "replace");
      return;
    }

    if ((me.needsTenantSelection || !me.currentTenant || !me.currentMembership) && route.kind !== "tenants" && route.kind !== "ops") {
      navigate({ kind: "tenants" }, "replace");
      return;
    }

    if (route.kind === "tenant" && window.location.pathname !== pathFromRoute(route)) {
      navigate(route, "replace");
    }
  }, [me, route.kind, route.kind === "tenant" ? route.tab : undefined, route.kind === "tenant" ? route.subTab : undefined]);

  async function login(qqUin: string, password: string) {
    setError("");
    const data = await api<MeResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ qqUin, password }),
    });
    setMe(data);
    if (data.authenticated) {
      navigate(data.needsTenantSelection ? { kind: "tenants" } : { kind: "tenant", tab: activeTab });
    }
  }

  async function logout() {
    await api<{ ok: true }>("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setMe({ authenticated: false });
    setPostText("");
    setUploadedImages([]);
    setPosts([]);
    navigate({ kind: "login" }, "replace");
  }

  async function selectTenant(tenantId: string) {
    await api("/api/session/tenant", {
      method: "POST",
      body: JSON.stringify({ tenantId }),
    });
    await refreshMe();
    navigate({ kind: "tenant", tab: activeTab });
  }

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) {
      return;
    }

    setBusy(true);
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
      toast.error(caught instanceof Error ? caught.message : "图片上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function submitPost() {
    setBusy(true);
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
      toast.success("投稿已提交，等待审核。");
      const data = await api<{ posts: PostItem[]; pagination: Pagination }>("/api/posts/mine?page=1&limit=10");
      setPosts(data.posts);
      setPostsPagination(data.pagination);
      setPostsPage(1);
      setActiveTab("posts");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "投稿失败");
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

  if (me.currentTenant && me.currentMembership && me.activeBan) {
    return <BannedScreen ban={me.activeBan} me={me} selectedTenant={me.currentTenant} onLogout={logout} />;
  }

  if (route.kind === "tenants") {
    if (me.user.systemRole === "system_operator") {
      return <TenantSelectionScreen me={me} onSelectTenant={selectTenant} onOpenOps={() => navigate({ kind: "ops" })} onLogout={logout} />;
    }

    return <TenantSelectionScreen me={me} onSelectTenant={selectTenant} onLogout={logout} />;
  }

  if (me.user.systemRole === "system_operator" && (route.kind === "ops" || me.memberships.length === 0)) {
    if (me.memberships.length > 0) {
      return <OpsStandaloneScreen me={me} onBackToTenants={() => navigate({ kind: "tenants" })} onLogout={logout} />;
    }

    return <OpsStandaloneScreen me={me} onLogout={logout} />;
  }

  if (me.needsTenantSelection || !me.currentTenant || !me.currentMembership) {
    if (me.user.systemRole === "system_operator") {
      return <TenantSelectionScreen me={me} onSelectTenant={selectTenant} onOpenOps={() => navigate({ kind: "ops" })} onLogout={logout} />;
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
      adminTab={route.kind === "tenant" && route.tab === "admin" ? (route.subTab as AdminTab | undefined) ?? "users" : "users"}
      me={me as AuthenticatedMe & { currentTenant: NonNullable<AuthenticatedMe["currentTenant"]>; currentMembership: NonNullable<AuthenticatedMe["currentMembership"]> }}
      navItems={availableNavItems}
      metadata={metadata}
      posts={posts}
      busy={busy}
      dataLoading={tenantDataLoading}
      postText={postText}
      postsTab={route.kind === "tenant" && route.tab === "posts" ? (route.subTab as PostsTab | undefined) ?? "mine" : "mine"}
      postsPagination={postsPagination}
      anonymous={anonymous}
      uploadedImages={uploadedImages}
      onActiveTabChange={setActiveTab}
      onAdminTabChange={setAdminSubTab}
      onAnonymousChange={setAnonymous}
      onFilesSelected={uploadFiles}
      onLogout={logout}
      onOpenOps={me.user.systemRole === "system_operator" ? () => navigate({ kind: "ops" }) : undefined}
      onPostTextChange={setPostText}
      onPostsTabChange={setPostsSubTab}
      onRefreshMe={refreshMe}
      onPostsPageChange={setPostsPage}
      onRefreshTenantData={() => refreshTenantData(postsPage)}
      onRemoveImage={(key) => setUploadedImages((current) => current.filter((image) => image.key !== key))}
      onSubmitPost={submitPost}
    />
  );
}

function defaultPagination(): Pagination {
  return {
    page: 1,
    limit: 10,
    total: 0,
    pageCount: 1,
  };
}

function routeFromPath(pathname: string): AppRoute {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/login") {
    return { kind: "login" };
  }
  if (normalized === "/tenants") {
    return { kind: "tenants" };
  }
  if (normalized === "/ops") {
    return { kind: "ops" };
  }

  const matchedPostsTab = (Object.entries(postsTabPaths) as Array<[PostsTab, string]>).find(([, path]) => path === normalized)?.[0];
  if (matchedPostsTab) {
    return { kind: "tenant", tab: "posts", subTab: matchedPostsTab };
  }

  const matchedAdminTab = (Object.entries(adminTabPaths) as Array<[AdminTab, string]>).find(([, path]) => path === normalized)?.[0];
  if (matchedAdminTab) {
    return { kind: "tenant", tab: "admin", subTab: matchedAdminTab };
  }

  if (normalized === "/posts/mine") {
    return { kind: "tenant", tab: "posts", subTab: "mine" };
  }
  if (normalized === "/admin/users") {
    return { kind: "tenant", tab: "admin", subTab: "users" };
  }
  if (normalized === "/admin/review") {
    return { kind: "tenant", tab: "posts", subTab: "review" };
  }

  const matchedTab = (Object.entries(tabPaths) as Array<[MainTab, string]>).find(([, path]) => path === normalized)?.[0];
  return {
    kind: "tenant",
    tab: matchedTab ?? "post",
  };
}

function pathFromRoute(route: AppRoute) {
  if (route.kind === "tenant") {
    if (route.tab === "posts" && route.subTab) {
      return postsTabPaths[route.subTab as PostsTab] ?? tabPaths.posts;
    }
    if (route.tab === "admin" && route.subTab) {
      return adminTabPaths[route.subTab as AdminTab] ?? tabPaths.admin;
    }
    return tabPaths[route.tab];
  }
  return `/${route.kind}`;
}
