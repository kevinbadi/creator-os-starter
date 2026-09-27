-- Creator OS Starter: database schema (structure only, no data).
-- Generated from the reference deployment with pg_dump --schema-only.
-- Apply with: npm run db:setup   (idempotent: skips if the tables already exist)

--
-- PostgreSQL database dump
--

-- Dumped from database version 15.18 (Debian 15.18-1.pgdg13+1)
-- Dumped by pg_dump version 18.4

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

--
-- Name: accomplishments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE accomplishments (
    id text NOT NULL,
    date date NOT NULL,
    text text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: advice_tip_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE advice_tip_usage (
    persona text NOT NULL,
    tip_key text NOT NULL,
    uses integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: agent_clones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE agent_clones (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona text NOT NULL,
    format text NOT NULL,
    slug text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    notes text,
    source_url text,
    clip_name text,
    error text,
    pid integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: agent_edits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE agent_edits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow text DEFAULT 'split-animated-talking-head'::text NOT NULL,
    slug text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    notes text,
    source_url text,
    clip_name text,
    error text,
    pid integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: agent_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE agent_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    step text,
    error text,
    profile_id text NOT NULL,
    video_url text NOT NULL,
    resource_url text NOT NULL,
    transcript text,
    keyword text,
    caption text,
    youtube_title text,
    youtube_description text,
    twitter_caption text,
    linkedin_caption text,
    threads_caption text,
    dm_text text,
    comment_reply text,
    thumbnail_url text,
    scheduled_for timestamp with time zone,
    zernio_post_id text,
    comment_dm_status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    dm_note text,
    followup_zernio_post_id text,
    platforms text[]
);

--
-- Name: ai_news_briefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE ai_news_briefs (
    brief_date date NOT NULL,
    headline text NOT NULL,
    bullets jsonb DEFAULT '[]'::jsonb NOT NULL,
    video_ideas jsonb DEFAULT '[]'::jsonb NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    sources jsonb DEFAULT '{}'::jsonb NOT NULL,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: ai_news_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE ai_news_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    summary text,
    url text,
    source text DEFAULT 'manual'::text NOT NULL,
    source_id text NOT NULL,
    image_url text,
    published_at timestamp with time zone,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    extra jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT ai_news_items_kind_check CHECK ((kind = ANY (ARRAY['news'::text, 'tool'::text, 'idea'::text]))),
    CONSTRAINT ai_news_items_status_check CHECK ((status = ANY (ARRAY['new'::text, 'saved'::text, 'used'::text, 'dismissed'::text])))
);

--
-- Name: analytics_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE analytics_snapshots (
    id bigint NOT NULL,
    snapshot_date date NOT NULL,
    platform_post_id text NOT NULL,
    platform text,
    account_username text,
    content text,
    views integer DEFAULT 0 NOT NULL,
    likes integer DEFAULT 0 NOT NULL,
    comments integer DEFAULT 0 NOT NULL,
    saves integer DEFAULT 0 NOT NULL,
    shares integer DEFAULT 0 NOT NULL,
    impressions integer DEFAULT 0 NOT NULL,
    reach integer DEFAULT 0 NOT NULL,
    engagement_rate real,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    carried boolean DEFAULT false NOT NULL
);

--
-- Name: analytics_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE analytics_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: analytics_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE analytics_snapshots_id_seq OWNED BY analytics_snapshots.id;

--
-- Name: channel_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE channel_profiles (
    channel_id text NOT NULL,
    zernio_profile_id text NOT NULL,
    api_key text,
    api_key_name text,
    api_key_preview text
);

--
-- Name: channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE channels (
    id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    color text,
    subtitle text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revenuecat_project_id text,
    revenuecat_api_key text,
    posthog_project_id text,
    posthog_host text,
    CONSTRAINT channels_type_check CHECK ((type = ANY (ARRAY['personal'::text, 'app'::text, 'ugc'::text, 'yt-automation'::text])))
);

--
-- Name: comment_dm_setups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE comment_dm_setups (
    id bigint NOT NULL,
    zernio_post_id text NOT NULL,
    profile_id text NOT NULL,
    account_id text NOT NULL,
    platform text NOT NULL,
    platform_post_id text,
    keyword text NOT NULL,
    dm_message text DEFAULT ''::text NOT NULL,
    resource_url text NOT NULL,
    zernio_automation_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    wired_at timestamp with time zone,
    comment_reply text DEFAULT 'Awesome, check DMs!'::text NOT NULL,
    scheduled_for timestamp with time zone
);

--
-- Name: comment_dm_setups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE comment_dm_setups_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: comment_dm_setups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE comment_dm_setups_id_seq OWNED BY comment_dm_setups.id;

--
-- Name: comment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE comment_events (
    event_id text NOT NULL,
    platform text NOT NULL,
    account_id text NOT NULL,
    account_username text,
    post_id text,
    platform_post_id text,
    comment_id text NOT NULL,
    comment_text text,
    author_id text,
    author_username text,
    author_name text,
    is_reply boolean DEFAULT false NOT NULL,
    parent_comment_id text,
    comment_created_at timestamp with time zone,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    status_reason text,
    replied_at timestamp with time zone,
    reply_comment_id text,
    raw jsonb,
    is_own boolean DEFAULT false NOT NULL
);

--
-- Name: content_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE content_posts (
    id bigint NOT NULL,
    persona text,
    carousel_id text,
    zernio_post_id text,
    content text,
    media_urls jsonb,
    platforms jsonb,
    status text,
    scheduled_for timestamp with time zone,
    posted_at timestamp with time zone,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: content_posts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE content_posts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: content_posts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE content_posts_id_seq OWNED BY content_posts.id;

--
-- Name: copywriter_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE copywriter_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    url text NOT NULL,
    run_id text,
    status text DEFAULT 'queued'::text NOT NULL,
    transcript text,
    caption text,
    hook3s text,
    username text,
    thumbnail_url text,
    like_count bigint,
    comment_count bigint,
    view_count bigint,
    duration_sec numeric,
    language text,
    topic text,
    summary text,
    hook text,
    key_points jsonb,
    format text,
    cta text,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    tag text,
    posted_at timestamp with time zone,
    title text,
    rewrite text,
    rewrite_skill text,
    rewritten_at timestamp with time zone
);

--
-- Name: daily_view_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE daily_view_snapshots (
    snapshot_date date NOT NULL,
    account_username text DEFAULT ''::text NOT NULL,
    platform text DEFAULT 'other'::text NOT NULL,
    total_views bigint DEFAULT 0 NOT NULL,
    post_count integer DEFAULT 0 NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: follower_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE follower_snapshots (
    id bigint NOT NULL,
    snapshot_date date NOT NULL,
    profile_id text NOT NULL,
    profile_name text,
    account_id text NOT NULL,
    platform text,
    username text,
    followers integer DEFAULT 0 NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: follower_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE follower_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: follower_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE follower_snapshots_id_seq OWNED BY follower_snapshots.id;

--
-- Name: gifs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE gifs (
    id text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    preview_url text NOT NULL,
    mp4_url text NOT NULL,
    query text DEFAULT ''::text NOT NULL,
    checked boolean DEFAULT false NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: goals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE goals (
    id text NOT NULL,
    title text NOT NULL,
    detail text,
    target_date date,
    status text DEFAULT 'in_progress'::text NOT NULL,
    progress integer DEFAULT 0 NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category text DEFAULT 'development'::text NOT NULL,
    target_time time without time zone,
    started_at timestamp with time zone,
    metric text,
    target_value integer,
    metric_channel_id text,
    CONSTRAINT goals_category_check CHECK ((category = ANY (ARRAY['development'::text, 'marketing'::text]))),
    CONSTRAINT goals_metric_check CHECK ((metric = ANY (ARRAY['downloads'::text, 'posts'::text]))),
    CONSTRAINT goals_progress_check CHECK (((progress >= 0) AND (progress <= 100))),
    CONSTRAINT goals_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'in_progress'::text, 'done'::text])))
);

--
-- Name: jev_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE jev_decisions (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    surface text NOT NULL,
    request text NOT NULL,
    tool text,
    tool_confidence real,
    tool_probabilities jsonb,
    range text,
    range_confidence real,
    model text,
    latency_ms integer,
    input_tokens integer,
    output_tokens integer,
    ok boolean DEFAULT true NOT NULL,
    error text
);

--
-- Name: jev_decisions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE jev_decisions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: jev_decisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE jev_decisions_id_seq OWNED BY jev_decisions.id;

--
-- Name: link_clicks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE link_clicks (
    id bigint NOT NULL,
    slug text NOT NULL,
    clicked_at timestamp with time zone DEFAULT now() NOT NULL,
    user_agent text,
    referer text
);

--
-- Name: link_clicks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE link_clicks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: link_clicks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE link_clicks_id_seq OWNED BY link_clicks.id;

--
-- Name: manager_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE manager_reports (
    id bigint NOT NULL,
    healthy boolean NOT NULL,
    report jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: manager_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE manager_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: manager_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE manager_reports_id_seq OWNED BY manager_reports.id;

--
-- Name: megos_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE megos_assets (
    id bigint NOT NULL,
    persona text,
    carousel_id text,
    slide_index integer,
    scene text,
    storage_url text,
    bucket text,
    object_key text,
    local_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: megos_assets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE megos_assets_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: megos_assets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE megos_assets_id_seq OWNED BY megos_assets.id;

--
-- Name: persona_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE persona_images (
    id bigint NOT NULL,
    persona text NOT NULL,
    md5 text NOT NULL,
    storage_url text NOT NULL,
    local_path text,
    prompt text,
    request_id text,
    source text DEFAULT 'fal'::text NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: persona_images_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE persona_images_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: persona_images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE persona_images_id_seq OWNED BY persona_images.id;

--
-- Name: personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE personas (
    id text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    brand text,
    niche text,
    persona_bio text,
    voice text,
    zernio_profile_id text,
    accounts jsonb DEFAULT '{}'::jsonb NOT NULL,
    carousel_platforms jsonb DEFAULT '["instagram", "tiktok"]'::jsonb NOT NULL,
    visual_pillars jsonb DEFAULT '[]'::jsonb NOT NULL,
    content_pillars jsonb DEFAULT '[]'::jsonb NOT NULL,
    topic_bank jsonb DEFAULT '[]'::jsonb NOT NULL,
    reference_image_path text,
    reference_image_url text,
    library_dir text,
    hashtag_bank jsonb DEFAULT '[]'::jsonb NOT NULL,
    questionnaire jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    location jsonb DEFAULT '{}'::jsonb NOT NULL
);

--
-- Name: philosophy_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE philosophy_content (
    id text NOT NULL,
    creator_id integer NOT NULL,
    platform text NOT NULL,
    platform_post_id text NOT NULL,
    url text,
    title text,
    caption text,
    published_at timestamp with time zone,
    duration_sec integer,
    transcript jsonb,
    transcript_text text,
    transcript_source text,
    visual_notes jsonb,
    summary text,
    thumbnail_url text,
    status text DEFAULT 'scraped'::text NOT NULL,
    error text,
    scraped_day text NOT NULL,
    analyzed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: philosophy_creators; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE philosophy_creators (
    id integer NOT NULL,
    slug text NOT NULL,
    display_name text NOT NULL,
    kind text DEFAULT 'shortform'::text NOT NULL,
    youtube_url text,
    instagram_url text,
    notes text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: philosophy_creators_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE philosophy_creators_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: philosophy_creators_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE philosophy_creators_id_seq OWNED BY philosophy_creators.id;

--
-- Name: philosophy_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE philosophy_insights (
    id integer NOT NULL,
    content_id text NOT NULL,
    creator_id integer NOT NULL,
    kind text DEFAULT 'point'::text NOT NULL,
    text text NOT NULL,
    quote text,
    start_sec numeric,
    end_sec numeric,
    topics text[] DEFAULT '{}'::text[] NOT NULL,
    strength integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: philosophy_insights_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE philosophy_insights_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

--
-- Name: philosophy_insights_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE philosophy_insights_id_seq OWNED BY philosophy_insights.id;

--
-- Name: publish_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE publish_claims (
    claim text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: revenuecat_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE revenuecat_customers (
    project_id text NOT NULL,
    customer_id text NOT NULL,
    first_seen_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: revenuecat_metric_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE revenuecat_metric_snapshots (
    project_id text NOT NULL,
    day text NOT NULL,
    metric_id text NOT NULL,
    value double precision NOT NULL,
    currency text,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: revenuecat_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE revenuecat_subscriptions (
    id text NOT NULL,
    channel_id text NOT NULL,
    project_id text NOT NULL,
    customer_id text NOT NULL,
    product_id text,
    status text,
    environment text,
    starts_at timestamp with time zone,
    current_period_ends_at timestamp with time zone,
    raw jsonb,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: sounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE sounds (
    id text NOT NULL,
    title text NOT NULL,
    author text,
    duration integer,
    region text,
    batch text,
    source_url text,
    audio_url text NOT NULL,
    mime text DEFAULT 'audio/mp4'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    favorite boolean DEFAULT false NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    chart text DEFAULT 'music'::text NOT NULL,
    checked boolean DEFAULT false NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    gender text DEFAULT 'any'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    vip_until timestamp with time zone,
    CONSTRAINT sounds_gender_check CHECK ((gender = ANY (ARRAY['female'::text, 'male'::text, 'any'::text])))
);

--
-- Name: web_analytics_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE web_analytics_snapshots (
    snapshot_date date NOT NULL,
    channel_id text NOT NULL,
    project_id text NOT NULL,
    visitors integer DEFAULT 0 NOT NULL,
    pageviews integer DEFAULT 0 NOT NULL,
    sessions integer DEFAULT 0 NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL
);

--
-- Name: analytics_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY analytics_snapshots ALTER COLUMN id SET DEFAULT nextval('analytics_snapshots_id_seq'::regclass);

--
-- Name: comment_dm_setups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY comment_dm_setups ALTER COLUMN id SET DEFAULT nextval('comment_dm_setups_id_seq'::regclass);

--
-- Name: content_posts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY content_posts ALTER COLUMN id SET DEFAULT nextval('content_posts_id_seq'::regclass);

--
-- Name: follower_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY follower_snapshots ALTER COLUMN id SET DEFAULT nextval('follower_snapshots_id_seq'::regclass);

--
-- Name: jev_decisions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY jev_decisions ALTER COLUMN id SET DEFAULT nextval('jev_decisions_id_seq'::regclass);

--
-- Name: link_clicks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY link_clicks ALTER COLUMN id SET DEFAULT nextval('link_clicks_id_seq'::regclass);

--
-- Name: manager_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY manager_reports ALTER COLUMN id SET DEFAULT nextval('manager_reports_id_seq'::regclass);

--
-- Name: megos_assets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY megos_assets ALTER COLUMN id SET DEFAULT nextval('megos_assets_id_seq'::regclass);

--
-- Name: persona_images id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY persona_images ALTER COLUMN id SET DEFAULT nextval('persona_images_id_seq'::regclass);

--
-- Name: philosophy_creators id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY philosophy_creators ALTER COLUMN id SET DEFAULT nextval('philosophy_creators_id_seq'::regclass);

--
-- Name: philosophy_insights id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY philosophy_insights ALTER COLUMN id SET DEFAULT nextval('philosophy_insights_id_seq'::regclass);

--
-- Name: accomplishments accomplishments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY accomplishments
    ADD CONSTRAINT accomplishments_pkey PRIMARY KEY (id);

--
-- Name: advice_tip_usage advice_tip_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY advice_tip_usage
    ADD CONSTRAINT advice_tip_usage_pkey PRIMARY KEY (persona, tip_key);

--
-- Name: agent_clones agent_clones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_clones
    ADD CONSTRAINT agent_clones_pkey PRIMARY KEY (id);

--
-- Name: agent_edits agent_edits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_edits
    ADD CONSTRAINT agent_edits_pkey PRIMARY KEY (id);

--
-- Name: agent_posts agent_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY agent_posts
    ADD CONSTRAINT agent_posts_pkey PRIMARY KEY (id);

--
-- Name: ai_news_briefs ai_news_briefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY ai_news_briefs
    ADD CONSTRAINT ai_news_briefs_pkey PRIMARY KEY (brief_date);

--
-- Name: ai_news_items ai_news_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY ai_news_items
    ADD CONSTRAINT ai_news_items_pkey PRIMARY KEY (id);

--
-- Name: analytics_snapshots analytics_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY analytics_snapshots
    ADD CONSTRAINT analytics_snapshots_pkey PRIMARY KEY (id);

--
-- Name: analytics_snapshots analytics_snapshots_snapshot_date_platform_post_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY analytics_snapshots
    ADD CONSTRAINT analytics_snapshots_snapshot_date_platform_post_id_key UNIQUE (snapshot_date, platform_post_id);

--
-- Name: channel_profiles channel_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY channel_profiles
    ADD CONSTRAINT channel_profiles_pkey PRIMARY KEY (channel_id, zernio_profile_id);

--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);

--
-- Name: comment_dm_setups comment_dm_setups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY comment_dm_setups
    ADD CONSTRAINT comment_dm_setups_pkey PRIMARY KEY (id);

--
-- Name: comment_events comment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY comment_events
    ADD CONSTRAINT comment_events_pkey PRIMARY KEY (event_id);

--
-- Name: content_posts content_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY content_posts
    ADD CONSTRAINT content_posts_pkey PRIMARY KEY (id);

--
-- Name: copywriter_sources copywriter_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY copywriter_sources
    ADD CONSTRAINT copywriter_sources_pkey PRIMARY KEY (id);

--
-- Name: daily_view_snapshots daily_view_snapshots_snapshot_date_account_username_platfor_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY daily_view_snapshots
    ADD CONSTRAINT daily_view_snapshots_snapshot_date_account_username_platfor_key UNIQUE (snapshot_date, account_username, platform);

--
-- Name: follower_snapshots follower_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY follower_snapshots
    ADD CONSTRAINT follower_snapshots_pkey PRIMARY KEY (id);

--
-- Name: follower_snapshots follower_snapshots_snapshot_date_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY follower_snapshots
    ADD CONSTRAINT follower_snapshots_snapshot_date_account_id_key UNIQUE (snapshot_date, account_id);

--
-- Name: gifs gifs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY gifs
    ADD CONSTRAINT gifs_pkey PRIMARY KEY (id);

--
-- Name: goals goals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY goals
    ADD CONSTRAINT goals_pkey PRIMARY KEY (id);

--
-- Name: jev_decisions jev_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY jev_decisions
    ADD CONSTRAINT jev_decisions_pkey PRIMARY KEY (id);

--
-- Name: link_clicks link_clicks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY link_clicks
    ADD CONSTRAINT link_clicks_pkey PRIMARY KEY (id);

--
-- Name: manager_reports manager_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY manager_reports
    ADD CONSTRAINT manager_reports_pkey PRIMARY KEY (id);

--
-- Name: megos_assets megos_assets_carousel_id_slide_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY megos_assets
    ADD CONSTRAINT megos_assets_carousel_id_slide_index_key UNIQUE (carousel_id, slide_index);

--
-- Name: megos_assets megos_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY megos_assets
    ADD CONSTRAINT megos_assets_pkey PRIMARY KEY (id);

--
-- Name: persona_images persona_images_md5_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY persona_images
    ADD CONSTRAINT persona_images_md5_key UNIQUE (md5);

--
-- Name: persona_images persona_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY persona_images
    ADD CONSTRAINT persona_images_pkey PRIMARY KEY (id);

--
-- Name: personas personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY personas
    ADD CONSTRAINT personas_pkey PRIMARY KEY (id);

--
-- Name: personas personas_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY personas
    ADD CONSTRAINT personas_slug_key UNIQUE (slug);

--
-- Name: philosophy_content philosophy_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY philosophy_content
    ADD CONSTRAINT philosophy_content_pkey PRIMARY KEY (id);

--
-- Name: philosophy_content philosophy_content_platform_platform_post_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY philosophy_content
    ADD CONSTRAINT philosophy_content_platform_platform_post_id_key UNIQUE (platform, platform_post_id);

--
-- Name: philosophy_creators philosophy_creators_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY philosophy_creators
    ADD CONSTRAINT philosophy_creators_pkey PRIMARY KEY (id);

--
-- Name: philosophy_creators philosophy_creators_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY philosophy_creators
    ADD CONSTRAINT philosophy_creators_slug_key UNIQUE (slug);

--
-- Name: philosophy_insights philosophy_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY philosophy_insights
    ADD CONSTRAINT philosophy_insights_pkey PRIMARY KEY (id);

--
-- Name: publish_claims publish_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY publish_claims
    ADD CONSTRAINT publish_claims_pkey PRIMARY KEY (claim);

--
-- Name: revenuecat_customers revenuecat_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY revenuecat_customers
    ADD CONSTRAINT revenuecat_customers_pkey PRIMARY KEY (project_id, customer_id);

--
-- Name: revenuecat_metric_snapshots revenuecat_metric_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY revenuecat_metric_snapshots
    ADD CONSTRAINT revenuecat_metric_snapshots_pkey PRIMARY KEY (project_id, day, metric_id);

--
-- Name: revenuecat_subscriptions revenuecat_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY revenuecat_subscriptions
    ADD CONSTRAINT revenuecat_subscriptions_pkey PRIMARY KEY (id);

--
-- Name: sounds sounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY sounds
    ADD CONSTRAINT sounds_pkey PRIMARY KEY (id);

--
-- Name: web_analytics_snapshots web_analytics_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY web_analytics_snapshots
    ADD CONSTRAINT web_analytics_snapshots_pkey PRIMARY KEY (snapshot_date, channel_id);

--
-- Name: accomplishments_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX accomplishments_date_idx ON accomplishments USING btree (date);

--
-- Name: agent_clones_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_clones_created_idx ON agent_clones USING btree (created_at DESC);

--
-- Name: agent_clones_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_clones_slug_idx ON agent_clones USING btree (slug);

--
-- Name: agent_edits_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_edits_created_idx ON agent_edits USING btree (created_at DESC);

--
-- Name: agent_edits_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_edits_slug_idx ON agent_edits USING btree (slug);

--
-- Name: agent_posts_profile_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_posts_profile_slot ON agent_posts USING btree (profile_id, scheduled_for) WHERE ((scheduled_for IS NOT NULL) AND (status <> 'failed'::text));

--
-- Name: agent_posts_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_posts_status_created ON agent_posts USING btree (status, created_at);

--
-- Name: ai_news_items_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_news_items_feed ON ai_news_items USING btree (status, ingested_at DESC);

--
-- Name: ai_news_items_source_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_news_items_source_uid ON ai_news_items USING btree (source, source_id);

--
-- Name: analytics_snapshots_acct_post_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_snapshots_acct_post_date ON analytics_snapshots USING btree (account_username, platform_post_id, snapshot_date);

--
-- Name: analytics_snapshots_post_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_snapshots_post_date ON analytics_snapshots USING btree (platform_post_id, snapshot_date);

--
-- Name: comment_dm_setups_pending_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_dm_setups_pending_due ON comment_dm_setups USING btree (scheduled_for, created_at) WHERE (status = 'pending'::text);

--
-- Name: comment_dm_setups_post_account; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX comment_dm_setups_post_account ON comment_dm_setups USING btree (zernio_post_id, account_id);

--
-- Name: comment_events_comment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX comment_events_comment_id ON comment_events USING btree (comment_id);

--
-- Name: comment_events_own_received; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_events_own_received ON comment_events USING btree (is_own, received_at);

--
-- Name: comment_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX comment_events_status ON comment_events USING btree (status, received_at DESC);

--
-- Name: copywriter_sources_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX copywriter_sources_created_idx ON copywriter_sources USING btree (created_at DESC);

--
-- Name: copywriter_sources_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX copywriter_sources_run_idx ON copywriter_sources USING btree (run_id);

--
-- Name: copywriter_sources_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX copywriter_sources_tag_idx ON copywriter_sources USING btree (tag);

--
-- Name: daily_view_snapshots_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX daily_view_snapshots_date_idx ON daily_view_snapshots USING btree (snapshot_date DESC);

--
-- Name: link_clicks_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX link_clicks_slug_idx ON link_clicks USING btree (slug, clicked_at);

--
-- Name: philosophy_content_creator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX philosophy_content_creator_idx ON philosophy_content USING btree (creator_id, published_at DESC NULLS LAST);

--
-- Name: philosophy_insights_content_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX philosophy_insights_content_idx ON philosophy_insights USING btree (content_id);

--
-- Name: philosophy_insights_topics_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX philosophy_insights_topics_idx ON philosophy_insights USING gin (topics);

--
-- Name: sounds_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sounds_batch_idx ON sounds USING btree (created_at DESC);

--
-- Name: sounds_favorite_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sounds_favorite_idx ON sounds USING btree (favorite) WHERE favorite;

--
-- Name: channel_profiles channel_profiles_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY channel_profiles
    ADD CONSTRAINT channel_profiles_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;

--
-- Name: philosophy_content philosophy_content_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY philosophy_content
    ADD CONSTRAINT philosophy_content_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES philosophy_creators(id);

--
-- Name: philosophy_insights philosophy_insights_content_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY philosophy_insights
    ADD CONSTRAINT philosophy_insights_content_id_fkey FOREIGN KEY (content_id) REFERENCES philosophy_content(id) ON DELETE CASCADE;

--
-- Name: philosophy_insights philosophy_insights_creator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY philosophy_insights
    ADD CONSTRAINT philosophy_insights_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES philosophy_creators(id);

--
-- PostgreSQL database dump complete
--
