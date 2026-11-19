<script setup lang="ts">
const profile=ref<any>(null);const username=ref('');const displayName=ref('');const bio=ref('');const avatar=ref('');const pending=ref(true);const busy=ref(false);const error=ref('');const notice=ref('')
useHead({title:'Edit Profile — Lantern'})
onMounted(async()=>{try{const r=await $fetch<any>('/api/studio/profile');profile.value={...r.profile,writable:r.writable};username.value=r.profile.username||'';displayName.value=r.profile.display_name||'';bio.value=r.profile.bio||'';avatar.value=r.profile.avatar||'';if(!r.writable)error.value='Production profiles are read-only in this staging version.'}catch(e:any){error.value=e?.data?.statusMessage||e?.message||'Profile could not be loaded.'}finally{pending.value=false}})
async function save(){busy.value=true;error.value='';notice.value='';try{const csrf=(await $fetch<{csrfToken:string}>('/api/auth/csrf')).csrfToken;const r=await $fetch<any>('/api/studio/profile',{method:'PUT',body:{username:username.value,display_name:displayName.value,bio:bio.value,avatar:avatar.value,csrfToken:csrf}});notice.value=r.message;await navigateTo(`/@${r.username}?source=staging`)}catch(e:any){error.value=e?.data?.statusMessage||e?.message||'Profile could not be saved.'}finally{busy.value=false}}
</script>
<template>
  <section class="profile-edit-page">
    <div class="profile-edit-container">
      <header class="profile-edit-header">
        <div class="profile-edit-eyebrow">Profile</div>
        <h1>Edit Profile</h1>
        <p>Shape how other creators and readers see you on Lantern.</p>
      </header>
      <p v-if="pending">Loading profile…</p>
      <div v-else class="profile-edit-card">
        <p v-if="error" class="flash error">{{ error }}</p>
        <p v-if="notice" class="flash success">{{ notice }}</p>
        <form class="profile-form" @submit.prevent="save">
          <div class="profile-field">
            <label for="username">Username</label>
            <input id="username" v-model="username" minlength="3" maxlength="30" autocomplete="username" required :disabled="!profile || !profile.writable">
            <small>Your public Lantern address will be /@{{ username }}</small>
          </div>
          <div class="profile-field">
            <label for="display_name">Display Name</label>
            <input id="display_name" v-model="displayName" maxlength="100" required :disabled="!profile || !profile.writable">
            <small>This is the name readers will see across Lantern.</small>
          </div>
          <div class="profile-field">
            <label for="bio">Bio</label>
            <textarea id="bio" v-model="bio" maxlength="500" rows="6" placeholder="Tell readers a little about yourself…" :disabled="!profile || !profile.writable"></textarea>
            <small>Maximum 500 characters.</small>
          </div>
          <div class="profile-divider"></div>
          <div class="profile-field">
            <label for="avatar">Avatar Image URL</label>
            <input id="avatar" v-model="avatar" type="text" placeholder="Optional — paste an image URL" :disabled="!profile || !profile.writable">
            <small>Optional. Leave this blank if you don't want to use an avatar yet.</small>
          </div>
          <div class="profile-avatar-note">
            <div class="profile-avatar-note-icon">✦</div>
            <div class="profile-avatar-note-text">Proper image uploads are coming later. For now, you can leave this field completely empty.</div>
          </div>
          <div class="profile-actions">
            <button type="submit" class="profile-save-button" :disabled="busy || !profile?.writable">{{ busy ? 'Saving…' : 'Save Profile' }}</button>
            <NuxtLink :to="`/@${username}?source=staging`" class="profile-cancel-button">View Public Profile</NuxtLink>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>
<style scoped>
/* =========================================================
       EDIT PROFILE
       ========================================================= */

    .profile-edit-page {
        min-height: calc(100vh - 120px);
        padding: 70px 20px 100px;
    }


    .profile-edit-container {
        width: 100%;
        max-width: 860px;
        margin: 0 auto;
    }


    .profile-edit-header {
        margin-bottom: 34px;
    }


    .profile-edit-eyebrow {
        margin-bottom: 12px;
        color: var(--gold-bright, #f4b94e);
        font-family: Georgia, serif;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
    }


    .profile-edit-header h1 {
        margin: 0 0 12px;
        color: var(--ivory, #f1e4c3);
        font-family: Georgia, serif;
        font-size: clamp(2.3rem, 5vw, 3.5rem);
        line-height: 1.05;
    }


    .profile-edit-header p {
        max-width: 620px;
        margin: 0;
        color: rgba(241, 228, 195, 0.65);
        font-family: Georgia, serif;
        font-size: 1rem;
        line-height: 1.7;
    }


    .profile-edit-card {
        position: relative;
        padding: 38px;
        border: 1px solid rgba(216, 154, 58, 0.22);
        border-radius: 8px;
        background:
            linear-gradient(
                145deg,
                rgba(13, 27, 42, 0.92),
                rgba(5, 6, 8, 0.96)
            );
        box-shadow:
            0 24px 70px rgba(0, 0, 0, 0.42),
            inset 0 1px 0 rgba(255, 255, 255, 0.025);
    }


    .profile-edit-card::before {
        content: "";
        position: absolute;
        top: 0;
        left: 38px;
        right: 38px;
        height: 1px;
        background: linear-gradient(
            90deg,
            transparent,
            rgba(244, 185, 78, 0.6),
            transparent
        );
    }


    .profile-form {
        display: flex;
        flex-direction: column;
        gap: 26px;
    }


    .profile-field {
        display: flex;
        flex-direction: column;
    }


    .profile-field label {
        margin-bottom: 9px;
        color: var(--ivory, #f1e4c3);
        font-family: Georgia, serif;
        font-size: 0.95rem;
        font-weight: 700;
    }


    .profile-field input,
    .profile-field textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid rgba(216, 154, 58, 0.18);
        border-radius: 5px;
        outline: none;
        background: rgba(3, 4, 5, 0.72);
        color: var(--ivory, #f1e4c3);
        font-family: Georgia, serif;
        font-size: 1rem;
        transition:
            border-color 0.2s ease,
            box-shadow 0.2s ease,
            background 0.2s ease;
    }


    .profile-field input {
        min-height: 52px;
        padding: 0 15px;
    }


    .profile-field textarea {
        min-height: 150px;
        padding: 14px 15px;
        line-height: 1.65;
        resize: vertical;
    }


    .profile-field input::placeholder,
    .profile-field textarea::placeholder {
        color: rgba(241, 228, 195, 0.32);
    }


    .profile-field input:focus,
    .profile-field textarea:focus {
        border-color: rgba(244, 185, 78, 0.65);
        background: rgba(7, 17, 31, 0.9);
        box-shadow:
            0 0 0 3px rgba(216, 154, 58, 0.08),
            0 8px 25px rgba(0, 0, 0, 0.2);
    }


    .profile-field small {
        margin-top: 8px;
        color: rgba(241, 228, 195, 0.48);
        font-family: Georgia, serif;
        font-size: 0.8rem;
        line-height: 1.5;
    }


    .profile-field small strong {
        color: rgba(241, 228, 195, 0.68);
    }


    .profile-divider {
        width: 100%;
        height: 1px;
        margin: 2px 0;
        background: linear-gradient(
            90deg,
            transparent,
            rgba(216, 154, 58, 0.18),
            transparent
        );
    }


    .profile-actions {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-top: 4px;
    }


    .profile-save-button {
        min-height: 48px;
        padding: 0 24px;
        border: 1px solid rgba(244, 185, 78, 0.7);
        border-radius: 4px;
        background:
            linear-gradient(
                135deg,
                #d89a3a,
                #b97824
            );
        color: #080706;
        font-family: Georgia, serif;
        font-size: 0.92rem;
        font-weight: 700;
        letter-spacing: 0.02em;
        cursor: pointer;
        box-shadow:
            0 8px 22px rgba(0, 0, 0, 0.25);
        transition:
            transform 0.2s ease,
            box-shadow 0.2s ease,
            background 0.2s ease;
    }


    .profile-save-button:hover {
        transform: translateY(-1px);
        background:
            linear-gradient(
                135deg,
                #f4b94e,
                #d89a3a
            );
        box-shadow:
            0 12px 28px rgba(0, 0, 0, 0.34);
    }


    .profile-cancel-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 22px;
        border: 1px solid rgba(241, 228, 195, 0.16);
        border-radius: 4px;
        background: rgba(241, 228, 195, 0.035);
        color: rgba(241, 228, 195, 0.75);
        font-family: Georgia, serif;
        font-size: 0.92rem;
        text-decoration: none;
        transition:
            border-color 0.2s ease,
            background 0.2s ease,
            color 0.2s ease;
    }


    .profile-cancel-button:hover {
        border-color: rgba(216, 154, 58, 0.35);
        background: rgba(216, 154, 58, 0.06);
        color: var(--ivory, #f1e4c3);
    }


    .profile-avatar-note {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        margin-top: -8px;
        padding: 14px 16px;
        border-left: 2px solid rgba(216, 154, 58, 0.45);
        background: rgba(216, 154, 58, 0.035);
    }


    .profile-avatar-note-icon {
        flex: 0 0 auto;
        color: var(--gold-bright, #f4b94e);
        font-size: 0.9rem;
        line-height: 1.5;
    }


    .profile-avatar-note-text {
        color: rgba(241, 228, 195, 0.52);
        font-family: Georgia, serif;
        font-size: 0.8rem;
        line-height: 1.55;
    }


    /* =========================================================
       MOBILE
       ========================================================= */

    @media (max-width: 700px) {

        .profile-edit-page {
            padding: 45px 16px 70px;
        }


        .profile-edit-header {
            margin-bottom: 25px;
        }


        .profile-edit-header h1 {
            font-size: 2.2rem;
        }


        .profile-edit-card {
            padding: 24px 20px;
        }


        .profile-edit-card::before {
            left: 20px;
            right: 20px;
        }


        .profile-form {
            gap: 22px;
        }


        .profile-actions {
            flex-direction: column;
            align-items: stretch;
        }


        .profile-save-button,
        .profile-cancel-button {
            width: 100%;
        }

    }
</style>
