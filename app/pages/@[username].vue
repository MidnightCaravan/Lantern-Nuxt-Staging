<script setup lang="ts">
const route = useRoute()
const username = computed(() => String(route.params.username || ''))
const requestedSource = computed(() => {
  const value = route.query.source
  const first = Array.isArray(value) ? value[0] : value
  return first ? String(first) : null
})
const apiUrl = computed(() => {
  const base = `/api/public/profiles/${encodeURIComponent(username.value)}`
  return requestedSource.value
    ? `${base}?source=${encodeURIComponent(requestedSource.value)}`
    : base
})
const { data, pending, error } = await useFetch<any>(apiUrl)

// Flask renders templates/404.html for an unknown creator
// (lantern_profiles.py:179-183).
if (isLanternNotFound(error.value)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
}

const source = computed(() => String(data.value?.source ?? requestedSource.value ?? 'production'))

function profileWorkHref(work: any) {
  const path = String(work.type).toLowerCase() === 'comic'
    ? `/comics/${work.id}`
    : `/works/${work.id}`
  return `${path}?source=${encodeURIComponent(source.value)}`
}
const profile = computed(() => data.value?.profile)
const works = computed(() => data.value?.works || [])
useHead({ title: computed(() => profile.value ? `${profile.value.display_name || profile.value.username} — Lantern` : 'Creator — Lantern') })
</script>
<template>
  <section class="public-profile-page">
    <div class="public-profile-container">
      <div v-if="pending" class="auth-card">Loading creator…</div>
      <div v-else-if="error || !profile" class="auth-card"><h1>Creator not found</h1><NuxtLink :to="`/discover?source=${encodeURIComponent(source)}`" class="button button-outline">Discover Lantern</NuxtLink></div>
      <template v-else>
        <header class="public-profile-header">
          <div class="profile-header-content">
            <div class="public-profile-avatar">
              <img v-if="profile.avatar" :src="profile.avatar" :alt="profile.display_name || profile.username">
              <div v-else class="public-profile-avatar-placeholder">✦</div>
            </div>
            <div class="profile-header-info">
              <div class="profile-eyebrow">Creator</div>
              <h1>{{ profile.display_name || profile.username }}</h1>
              <div class="profile-username">@{{ profile.username }}</div>
              <p v-if="profile.bio" class="profile-bio">{{ profile.bio }}</p>
            </div>
            <div v-if="data?.isOwner" class="profile-header-action">
              <NuxtLink to="/profile/edit" class="profile-edit-link">Edit Profile</NuxtLink>
            </div>
          </div>
        </header>
        <section class="profile-works-section">
          <div class="profile-section-heading">
            <h2>Published Works</h2>
            <span>{{ works.length }} {{ works.length === 1 ? 'work' : 'works' }}</span>
          </div>
          <div v-if="works.length" class="profile-work-grid">
            <NuxtLink v-for="work in works" :key="work.id" :to="profileWorkHref(work)" class="profile-work-card">
              <div class="profile-work-type">{{ work.type }}</div>
              <h3>{{ work.title }}</h3>
              <p>{{ work.description || 'A new story waiting to be discovered.' }}</p>
              <div class="profile-work-arrow">Explore →</div>
            </NuxtLink>
          </div>
          <div v-else class="profile-empty">
            <div class="profile-empty-symbol">✦</div>
            <h3>No published works yet</h3>
            <p>This creator hasn't released anything into the Lantern light yet.</p>
          </div>
        </section>
      </template>
    </div>
  </section>
</template>
<style scoped>
/* =========================================================
       PUBLIC PROFILE
       ========================================================= */

    .public-profile-page {
        min-height: calc(100vh - 120px);
        padding: 70px 20px 100px;
    }


    .public-profile-container {
        width: 100%;
        max-width: 1050px;
        margin: 0 auto;
    }


    /* =========================================================
       PROFILE HEADER
       ========================================================= */

    .public-profile-header {
        position: relative;
        overflow: hidden;
        padding: 42px;
        border: 1px solid rgba(216, 154, 58, 0.22);
        border-radius: 8px;
        background:
            radial-gradient(
                circle at 85% 15%,
                rgba(216, 154, 58, 0.08),
                transparent 35%
            ),
            linear-gradient(
                145deg,
                rgba(13, 27, 42, 0.94),
                rgba(5, 6, 8, 0.97)
            );
        box-shadow:
            0 25px 70px rgba(0, 0, 0, 0.42);
    }


    .public-profile-header::before {
        content: "";
        position: absolute;
        top: 0;
        left: 42px;
        right: 42px;
        height: 1px;
        background: linear-gradient(
            90deg,
            transparent,
            rgba(244, 185, 78, 0.65),
            transparent
        );
    }


    .profile-header-content {
        position: relative;
        display: flex;
        align-items: center;
        gap: 28px;
    }


    /* =========================================================
       AVATAR
       ========================================================= */

    .public-profile-avatar {
        width: 110px;
        height: 110px;
        flex: 0 0 110px;
        overflow: hidden;
        border: 1px solid rgba(216, 154, 58, 0.38);
        border-radius: 50%;
        background:
            radial-gradient(
                circle at center,
                rgba(216, 154, 58, 0.12),
                rgba(3, 4, 5, 0.95)
            );
        box-shadow:
            0 10px 35px rgba(0, 0, 0, 0.4);
    }


    .public-profile-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }


    .public-profile-avatar-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--gold-bright, #f4b94e);
        font-family: Georgia, serif;
        font-size: 2.4rem;
    }


    /* =========================================================
       PROFILE INFORMATION
       ========================================================= */

    .profile-header-info {
        min-width: 0;
        flex: 1;
    }


    .profile-eyebrow {
        margin-bottom: 8px;
        color: var(--gold-bright, #f4b94e);
        font-family: Georgia, serif;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
    }


    .profile-header-info h1 {
        margin: 0 0 7px;
        color: var(--ivory, #f1e4c3);
        font-family: Georgia, serif;
        font-size: clamp(2rem, 5vw, 3.1rem);
        line-height: 1.05;
    }


    .profile-username {
        margin-bottom: 15px;
        color: rgba(241, 228, 195, 0.48);
        font-family: Georgia, serif;
        font-size: 0.95rem;
    }


    .profile-bio {
        max-width: 700px;
        margin: 0;
        color: rgba(241, 228, 195, 0.68);
        font-family: Georgia, serif;
        font-size: 1rem;
        line-height: 1.7;
    }


    /* =========================================================
       PROFILE ACTION
       ========================================================= */

    .profile-header-action {
        flex: 0 0 auto;
    }


    .profile-edit-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 19px;
        border: 1px solid rgba(216, 154, 58, 0.3);
        border-radius: 4px;
        background: rgba(216, 154, 58, 0.05);
        color: var(--ivory, #f1e4c3);
        font-family: Georgia, serif;
        font-size: 0.88rem;
        text-decoration: none;
        transition:
            background 0.2s ease,
            border-color 0.2s ease,
            color 0.2s ease;
    }


    .profile-edit-link:hover {
        border-color: rgba(244, 185, 78, 0.6);
        background: rgba(216, 154, 58, 0.1);
        color: var(--gold-light, #ffd477);
    }


    /* =========================================================
       WORKS SECTION
       ========================================================= */

    .profile-works-section {
        margin-top: 60px;
    }


    .profile-section-heading {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 25px;
        padding-bottom: 16px;
        border-bottom: 1px solid rgba(216, 154, 58, 0.16);
    }


    .profile-section-heading h2 {
        margin: 0;
        color: var(--ivory, #f1e4c3);
        font-family: Georgia, serif;
        font-size: 1.8rem;
    }


    .profile-section-heading span {
        color: rgba(241, 228, 195, 0.42);
        font-family: Georgia, serif;
        font-size: 0.85rem;
    }


    /* =========================================================
       WORK GRID
       ========================================================= */

    .profile-work-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 20px;
    }


    .profile-work-card {
        display: flex;
        flex-direction: column;
        min-height: 190px;
        padding: 25px;
        border: 1px solid rgba(216, 154, 58, 0.15);
        border-radius: 7px;
        background:
            linear-gradient(
                145deg,
                rgba(13, 27, 42, 0.7),
                rgba(5, 6, 8, 0.86)
            );
        color: inherit;
        text-decoration: none;
        transition:
            transform 0.2s ease,
            border-color 0.2s ease,
            background 0.2s ease,
            box-shadow 0.2s ease;
    }


    .profile-work-card:hover {
        transform: translateY(-3px);
        border-color: rgba(216, 154, 58, 0.38);
        background:
            linear-gradient(
                145deg,
                rgba(13, 27, 42, 0.9),
                rgba(5, 6, 8, 0.95)
            );
        box-shadow:
            0 16px 35px rgba(0, 0, 0, 0.3);
    }


    .profile-work-type {
        margin-bottom: 15px;
        color: var(--gold-bright, #f4b94e);
        font-family: Georgia, serif;
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.15em;
        text-transform: uppercase;
    }


    .profile-work-card h3 {
        margin: 0 0 10px;
        color: var(--ivory, #f1e4c3);
        font-family: Georgia, serif;
        font-size: 1.35rem;
        line-height: 1.2;
    }


    .profile-work-card p {
        display: -webkit-box;
        overflow: hidden;
        margin: 0;
        color: rgba(241, 228, 195, 0.52);
        font-family: Georgia, serif;
        font-size: 0.87rem;
        line-height: 1.6;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
    }


    .profile-work-arrow {
        margin-top: auto;
        padding-top: 20px;
        color: rgba(244, 185, 78, 0.65);
        font-size: 0.9rem;
    }


    /* =========================================================
       EMPTY STATE
       ========================================================= */

    .profile-empty {
        padding: 55px 25px;
        border: 1px dashed rgba(216, 154, 58, 0.2);
        border-radius: 7px;
        text-align: center;
        background: rgba(13, 27, 42, 0.25);
    }


    .profile-empty-symbol {
        margin-bottom: 12px;
        color: rgba(244, 185, 78, 0.55);
        font-size: 1.6rem;
    }


    .profile-empty h3 {
        margin: 0 0 8px;
        color: var(--ivory, #f1e4c3);
        font-family: Georgia, serif;
        font-size: 1.3rem;
    }


    .profile-empty p {
        margin: 0;
        color: rgba(241, 228, 195, 0.45);
        font-family: Georgia, serif;
        font-size: 0.9rem;
    }


    /* =========================================================
       MOBILE
       ========================================================= */

    @media (max-width: 850px) {

        .profile-work-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
        }

    }


    @media (max-width: 650px) {

        .public-profile-page {
            padding: 45px 16px 70px;
        }


        .public-profile-header {
            padding: 28px 22px;
        }


        .public-profile-header::before {
            left: 22px;
            right: 22px;
        }


        .profile-header-content {
            flex-direction: column;
            align-items: flex-start;
        }


        .public-profile-avatar {
            width: 90px;
            height: 90px;
            flex-basis: 90px;
        }


        .profile-header-action {
            width: 100%;
        }


        .profile-edit-link {
            width: 100%;
        }


        .profile-work-grid {
            grid-template-columns: 1fr;
        }

    }
</style>
