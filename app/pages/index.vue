<script setup lang="ts">
const { data: featuredData, pending, error, refresh } = await useFetch<any>('/api/public/works', {
  query: { limit: 6 },
})
const featuredWorks = computed(() => featuredData.value?.works ?? [])

function workHref(work: any) {
  return String(work.type).toLowerCase() === 'comic' ? `/comics/${work.id}` : `/works/${work.id}`
}
</script>

<template>
  <div>
    <section class="hero lantern-hero-art">
      <div class="hero-inner">
        <div class="hero-copy">
          <div class="hero-eyebrow">A HOME FOR CREATIVE STORIES</div>
          <h1>LIGHT<br>YOUR<br>STORY.</h1>
          <p>A free creative community for novels, comics, videos, and stories made with AI.</p>
          <div class="hero-actions">
            <NuxtLink to="/register" class="button button-gold">Join Lantern — Free&nbsp; ›</NuxtLink>
            <a href="#discover" class="button button-outline">Explore Lantern&nbsp; ›</a>
          </div>
        </div>
      </div>
    </section>

    <section class="lantern-create-section">
      <div class="container">
        <div class="lantern-create-header">
          <div class="section-header">
            <div class="section-eyebrow">EXPLORE</div>
            <div class="lantern-ornament"><span></span></div>
            <h2>Bring Your Stories Into The Light.</h2>
          </div>
          <p class="lantern-create-note">Lantern is built around creative works, not algorithms designed to bury them.</p>
        </div>

        <div class="lantern-creative-grid">
          <NuxtLink to="/discover?type=novel" class="lantern-creative-card novels">
            <div class="lantern-creative-art"><img class="category-art-image category-art-novels" src="/images/lantern-hero.png" alt="" loading="lazy"></div>
            <div class="lantern-creative-content"><div class="lantern-card-icon">▣</div><h3>Novels</h3><p>Discover stories, chapters, serials, and complete novels.</p></div>
            <span class="lantern-card-arrow">›</span>
          </NuxtLink>
          <NuxtLink to="/discover?type=comic" class="lantern-creative-card comics">
            <div class="lantern-creative-art"><img class="category-art-image category-art-comics" src="/images/lantern-hero.png" alt="" loading="lazy"></div>
            <div class="lantern-creative-content"><div class="lantern-card-icon">◈</div><h3>Comics</h3><p>Discover comics, graphic stories, webtoons, and illustrated adventures.</p></div>
            <span class="lantern-card-arrow">›</span>
          </NuxtLink>
          <NuxtLink to="/discover?type=video" class="lantern-creative-card videos">
            <div class="lantern-creative-art"><img class="category-art-image category-art-videos" src="/images/lantern-hero.png" alt="" loading="lazy"></div>
            <div class="lantern-creative-content"><div class="lantern-card-icon">▶</div><h3>Videos</h3><p>Discover animated stories, short films, trailers, and creative videos.</p></div>
            <span class="lantern-card-arrow">›</span>
          </NuxtLink>
          <NuxtLink to="/discover" class="lantern-creative-card creators">
            <div class="lantern-creative-art"><img class="category-art-image category-art-creators" src="/images/lantern-hero.png" alt="" loading="lazy"></div>
            <div class="lantern-creative-content"><div class="lantern-card-icon">•••</div><h3>Creators</h3><p>Discover creative works from people across the Lantern community.</p></div>
            <span class="lantern-card-arrow">›</span>
          </NuxtLink>
        </div>
      </div>
    </section>

    <section class="section section-dark ai-section">
      <div class="container">
        <div class="ai-content">
          <div class="section-eyebrow">AI CREATORS</div>
          <h2>Made With AI? You're Welcome Here.</h2>
          <p>Lantern is intentionally open to AI-powered and AI-assisted creativity.</p>
          <p>If AI helped you write a novel, create artwork for a comic, produce a video, develop a character, or build an entire creative world, you can share it here.</p>
          <p>The important thing is that <strong>you are creating.</strong></p>
        </div>
      </div>
    </section>

    <section class="section section-blue" id="discover">
      <div class="container">
        <div class="section-header">
          <div class="section-eyebrow">DISCOVER</div>
          <h2>Find Your Next Story.</h2>
          <p>Discover works from creators across the Lantern community.</p>
        </div>

        <nav class="discover-tabs" aria-label="Filter featured works">
          <NuxtLink to="/discover" class="discover-tab active">All</NuxtLink>
          <NuxtLink to="/discover?type=novel" class="discover-tab">Novels</NuxtLink>
          <NuxtLink to="/discover?type=comic" class="discover-tab">Comics</NuxtLink>
          <NuxtLink to="/discover?type=video" class="discover-tab">Videos</NuxtLink>
          <NuxtLink to="/discover" class="discover-tab">AI Works</NuxtLink>
        </nav>

        <div v-if="pending" class="nuxt-state-card">Loading published works from Lantern…</div>
        <div v-else-if="error" class="nuxt-state-card">
          <h3>Published works are temporarily unavailable.</h3>
          <p>The read-only connection to Lantern's database isn't ready yet.</p>
          <button class="button button-outline" type="button" @click="refresh()">Try again</button>
        </div>
        <div v-else-if="featuredWorks.length" class="work-grid">
          <NuxtLink v-for="work in featuredWorks" :key="work.id" :to="workHref(work)" class="work-card">
            <div class="work-card-cover">
              <img v-if="work.coverUrl" :src="work.coverUrl" :alt="`${work.title} cover`" loading="lazy">
              <template v-else>🏮</template>
            </div>
            <div class="work-card-body">
              <span class="work-type">{{ String(work.type).toUpperCase() }}</span>
              <h3>{{ work.title }}</h3>
              <p>{{ work.description || 'A new story from a Lantern creator.' }}</p>
              <span class="work-creator">by {{ work.creatorName }}</span>
            </div>
          </NuxtLink>
        </div>
        <div v-else class="work-grid">
          <article class="work-card">
            <div class="work-card-cover">🏮</div>
            <div class="work-card-body">
              <span class="work-type">NOVEL</span>
              <h3>Coming Soon</h3>
              <p>The first stories of Lantern will appear here.</p>
            </div>
          </article>
          <article class="work-card">
            <div class="work-card-cover">🏮</div>
            <div class="work-card-body">
              <span class="work-type">COMIC</span>
              <h3>Your Story Could Be Here</h3>
              <p>Create an account and publish your work.</p>
            </div>
          </article>
          <article class="work-card">
            <div class="work-card-cover">🏮</div>
            <div class="work-card-body">
              <span class="work-type">VIDEO</span>
              <h3>Light Something New</h3>
              <p>Lantern is being built for creators.</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  </div>

    <section class="section section-dark join-section">
      <div class="container">
        <div class="section-header">
          <div class="section-eyebrow">JOIN LANTERN</div>
          <h2>Your Story Deserves A Light.</h2>
          <p>
            Create your free account and start building
            your creative space.
          </p>
        </div>
        <NuxtLink to="/register" class="button button-gold">
          Create Free Account
        </NuxtLink>
      </div>
    </section>
</template>
