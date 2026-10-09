import React, { useEffect, useState } from 'react';

import { createRoot } from 'react-dom/client';

import {

  Search,

  BrainCircuit,

  History,

  Layers,

  Instagram,

  Megaphone,

  ExternalLink,

  ImagePlus,

  Sparkles,

  RefreshCcw,

  Filter,

  CheckCircle2,

  AlertTriangle,

  Video,

  Clock,

  ChevronRight,

} from 'lucide-react';



import './style.css';



const API = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '');

async function get(path) {

  const response = await fetch(API + path);



  if (!response.ok) {

    throw Error(`API ${response.status}`);

  }



  return response.json();

}



function App() {

  const [input, setInput] = useState('');

  const [image, setImage] = useState('');

  const [preview, setPreview] = useState('');

  const [search, setSearch] = useState(null);

  const [history, setHistory] = useState([]);

  const [tab, setTab] = useState('instagram');

  const [sort, setSort] = useState('score');

  const [min, setMin] = useState(0);

  const [showSeen, setShowSeen] = useState(false);

  const [old, setOld] = useState([]);

  const [busy, setBusy] = useState(false);

  const [message, setMessage] = useState('');

  const [mode, setMode] = useState('');



  const reloadHistory = () => {

    get('/api/history')

      .then(setHistory)

      .catch(() => {});

  };



  useEffect(() => {

    reloadHistory();



    get('/api/health')

      .then((data) => setMode(data.mode))

      .catch(() =>

        setMessage(

          'Backend offline. Check VITE_API_URL and start the API.'

        )

      );

  }, []);



  useEffect(() => {

    if (

      !search?.id ||

      !['queued', 'running'].includes(search.status)

    ) {

      return;

    }



    const event = new EventSource(

      `${API}/api/search/${search.id}/events`

    );



    event.onmessage = async (e) => {

      const data = JSON.parse(e.data);



      setSearch((prev) => ({

        ...prev,

        ...data,

      }));



      if (['completed', 'failed'].includes(data.status)) {

        event.close();



        const full = await get(`/api/search/${search.id}`);



        setSearch(full);

        reloadHistory();

      }

    };



    event.onerror = () => {

      event.close();



      const timer = setInterval(async () => {

        try {

          const full = await get(`/api/search/${search.id}`);



          setSearch(full);



          if (['completed', 'failed'].includes(full.status)) {

            clearInterval(timer);

            reloadHistory();

          }

        } catch {}

      }, 3000);



      setTimeout(() => clearInterval(timer), 300000);

    };



    return () => event.close();

  }, [search?.id, search?.status]);



  useEffect(() => {

    if (showSeen) {

      get('/api/previous')

        .then(setOld)

        .catch(() => {});

    } else {

      setOld([]);

    }

  }, [showSeen]);



  async function submit(e) {

    e.preventDefault();



    setMessage('');

    setBusy(true);



    try {

      const response = await fetch(`${API}/api/search`, {

        method: 'POST',

        headers: {

          'Content-Type': 'application/json',

        },

        body: JSON.stringify({

          input,

          image: image || undefined,

        }),

      });



      const data = await response.json();



      if (!response.ok) {

        throw Error(data.error || 'Search failed');

      }



      setSearch({

        ...data,

        input,

        stage: 'Queued',

        results: [],

      });



      setTab('instagram');

      reloadHistory();

    } catch (error) {

      setMessage(error.message);

    } finally {

      setBusy(false);

    }

  }



  async function open(id) {

    try {

      setSearch(await get(`/api/search/${id}`));

      setTab('instagram');

    } catch (error) {

      setMessage(error.message);

    }

  }



  async function upload(e) {

    const file = e.target.files?.[0];



    if (!file) {

      return;

    }



    if (file.size > 2_000_000) {

      setMessage('Image size must be under 2 MB');

      return;

    }



    const reader = new FileReader();



    reader.onload = () => {

      setImage(reader.result);

      setPreview(reader.result);

    };



    reader.readAsDataURL(file);

  }



  const current = Array.isArray(search?.results)

    ? search.results

    : [];



  const previews = Array.isArray(search?.candidate_previews)

    ? search.candidate_previews

    : [];



  const previewCount = (platform) =>

    previews.filter((value) => value.platform === platform).length;



  const previous = showSeen

    ? old

        .filter((item) => item.id !== search?.id)

        .flatMap((item) =>

          (item.results || []).map((value) => ({

            ...value,

            previous: true,

          }))

        )

    : [];



  const verifiedEntries = [...current, ...previous].filter(

    (value) =>

      value.platform === tab &&

      value.match?.verified === true &&

      value.verificationStatus === 'verified' &&

      Number.isFinite(Number(value.match.score)) &&

      Number(value.match.score) >= Math.max(60, min)

  );



  const entries = [...verifiedEntries].sort((a, b) =>

    sort === 'newest'

      ? new Date(b.postedAt || 0) - new Date(a.postedAt || 0)

      : Number(b.match.score) - Number(a.match.score)

  );



  const count = (platform) =>

    current.filter(

      (value) =>

        value.platform === platform &&

        value.match?.verified === true &&

        value.verificationStatus === 'verified' &&

        Number(value.match?.score) >= 60

    ).length;



  const product = search?.product;
  const needsReference = search?.status === 'completed' && product && !product.image;




  return (

    <div className="shell">

      <aside className="sidebar">

        <div className="brand">

          <div className="logo">

            <BrainCircuit size={25} />

          </div>



          <div>

            <strong>

              FrameFinder<span>AI</span>

            </strong>



            <small>CREATIVE INTELLIGENCE</small>

          </div>

        </div>



        <div className="sideLabel">WORKSPACE</div>



        <div className="nav selected">

          <Layers size={18} />

          Discovery Studio

        </div>



        <div className="sideLabel historyLabel">

          RECENT SEARCHES

        </div>



        <div className="history">

          {history.length === 0 ? (

            <p className="muted">

              Your discoveries appear here.

            </p>

          ) : (

            history.map((item) => (

              <button

                key={item.id}

                onClick={() => open(item.id)}

                className={

                  search?.id === item.id ? 'active' : ''

                }

              >

                <History size={15} />



                <span>

                  {item.input}



                  <small>

                    {new Date(

                      item.created_at

                    ).toLocaleDateString()}{' '}

                    · {item.count || 0} videos

                  </small>

                </span>



                <ChevronRight size={14} />

              </button>

            ))

          )}

        </div>



        <div className="bottom">

          <div className="pulse" />



          {mode === 'DEMO'

            ? 'Demo / sample data'

            : mode === 'LIVE'

              ? 'Live provider mode'

              : 'Connecting...'}



          <small>Node.js · React · PostgreSQL</small>

        </div>

      </aside>



      <main>

        <header>

          <div>

            <span className="eyebrow">

              <Sparkles size={14} />

              AI-POWERED PRODUCT DISCOVERY

            </span>



            <h1>

              Find the creative.

              <br />

              <em>Match the product.</em>

            </h1>



            <p>

              Discover product-specific short-form videos

              using visual intelligence, not just keywords.

            </p>

          </div>



          <div className="headerBadge">

            <BrainCircuit size={27} />



            <div>

              <strong>Visual matching engine</strong>

              <span>Image-first product intelligence</span>

            </div>

          </div>

        </header>



        <section className="searchPanel">

          <form onSubmit={submit}>

            <div className="inputRow">

              <Search size={21} />



              <input

                aria-label="Product name or URL"

                placeholder="Enter a product name or paste a product URL..."

                value={input}

                onChange={(e) => setInput(e.target.value)}

                required

              />



              <label

                title="Upload reference product photo"

                className="upload"

              >

                <ImagePlus size={20} />



                <input

                  type="file"

                  accept="image/png,image/jpeg,image/webp"

                  onChange={upload}

                  hidden

                />

              </label>



              <button disabled={busy || !input.trim()}>

                <Sparkles size={17} />



                {busy ? 'Starting...' : 'Analyze product'}

              </button>

            </div>



            {preview && (

              <div className="uploaded">

                <img src={preview} alt="Uploaded product reference" />



                Product reference image attached



                <button

                  type="button"

                  onClick={() => {

                    setImage('');

                    setPreview('');

                  }}

                >

                  Remove

                </button>

              </div>

            )}

          </form>



          <div className="hints">

            <span>TRY A SEARCH</span>



            {[

              'oversized graphic tee',

              'protein dark chocolate',

              'running shoes',

            ].map((query) => (

              <button

                key={query}

                onClick={() => setInput(query)}

              >

                {query} ↗

              </button>

            ))}

          </div>

        </section>



        {message && (

          <div className="notice danger">

            <AlertTriangle size={18} />

            {message}

          </div>

        )}



        {mode === 'DEMO' && (

          <div className="notice warning">

            <AlertTriangle size={17} />



            Demo mode is active. Generated sample records are NOT

            real Instagram reels or Meta ads. Configure providers

            before client validation.

          </div>

        )}



        {needsReference && (
          <div className="notice warning" role="status">
            <AlertTriangle size={18} />
            <span>Videos were found, but visual matching needs a specific product image. Upload a product photo, paste its URL, or select a product from your catalog, then search again. Candidate previews are not verified matches.</span>
          </div>
        )}
        {search && (

          <>

            <div className="statusBar">

              <div>

                <span

                  className={`statusdot ${search.status}`}

                />



                <strong>

                  {search.stage || search.status}

                </strong>



                <small>

                  {search.status === 'running'

                    ? 'AI pipeline is processing your search'

                    : search.status === 'completed'

                      ? 'Search finished — inspect coverage and match quality'

                      : search.status === 'failed'

                        ? search.error

                        : 'Waiting for worker'}

                </small>

              </div>



              <div className="statusRight">

                {search.status === 'running' ||

                search.status === 'queued' ? (

                  <span className="spinner" />

                ) : (

                  <CheckCircle2 size={19} />

                )}



                {search.status.toUpperCase()}

              </div>

            </div>



            {product && (

              <section className="productPanel">

                <div className="productImage">

                  {product.image ? (

                    <img

                      src={product.image}

                      alt="Reference product"

                    />

                  ) : (

                    <ImagePlus size={42} />

                  )}

                </div>



                <div className="productInfo">

                  <span className="eyebrow">

                    PRODUCT INTELLIGENCE

                  </span>



                  <h2>{product.title}</h2>



                  <p>

                    {product.description ||

                      'No product description available. Attach a reference image to enable visual matching.'}

                  </p>



                  <div className="chips">

                    {Object.entries(product.attributes || {})

                      .filter(([key]) => key !== 'queries')

                      .flatMap(([key, value]) =>

                        Array.isArray(value)

                          ? value.map(

                              (item) => `${key}: ${item}`

                            )

                          : value && value !== 'unknown'

                            ? [`${key}: ${value}`]

                            : []

                      )

                      .slice(0, 14)

                      .map((attribute, index) => (

                        <span key={index}>{attribute}</span>

                      ))}

                  </div>



                  <small

                    className={

                      product.visionVerified

                        ? 'ok'

                        : 'warn'

                    }

                  >

                    {product.visionVerified

                      ? '✓ Vision attributes extracted'

                      : `⚠ Vision analysis unverified: ${

                          product.visionIssue || 'No image'

                        }`}

                  </small>

                </div>

              </section>

            )}



            {product?.productCandidates?.length > 0 &&

              !product.visionVerified && (

                <section

                  className="results"

                  style={{ marginTop: 18 }}

                >

                  <div className="resultsTop">

                    <div>

                      <span className="eyebrow">

                        PRODUCT REFERENCE SELECTION

                      </span>



                      <h2>Choose your exact product</h2>



                      <p className="muted">

                        Keyword discovery found possible

                        products, but none was selected

                        automatically. Select a real product page,

                        then click Analyze product again. No

                        candidate is treated as an exact match

                        without a reference.

                      </p>

                    </div>

                  </div>



                  <div className="grid">

                    {product.productCandidates.map(

                      (candidate, index) => (

                        <article

                          className="videoCard"

                          key={

                            candidate.sourceUrl +

                            String(index)

                          }

                        >

                          <div className="thumb">

                            {candidate.image ? (

                              <img

                                src={candidate.image}

                                alt={candidate.title}

                              />

                            ) : (

                              <ImagePlus size={36} />

                            )}

                          </div>



                          <div className="cardBody">

                            <strong>

                              {candidate.title}

                            </strong>



                            <p className="caption">

                              {candidate.brand ||

                                candidate.seller ||

                                ''}

                            </p>



                            <button

                              type="button"

                              onClick={() => {

                                setInput(

                                  candidate.sourceUrl

                                );

                                setImage('');

                                setPreview('');



                                window.scrollTo({

                                  top: 0,

                                  behavior: 'smooth',

                                });

                              }}

                            >

                              Use this product URL

                            </button>

                          </div>

                        </article>

                      )

                    )}

                  </div>

                </section>

              )}



            {search.status === 'completed' && (

              <>

                <div className="summary">

                  <div>

                    <span>TOTAL UNIQUE MATCHES</span>

                    <strong>{current.length}</strong>

                  </div>



                  <div>

                    <span>INSTAGRAM REELS</span>



                    <strong>

                      {count('instagram')}{' '}

                      <small>/ 20</small>

                    </strong>

                  </div>



                  <div>

                    <span>META AD LIBRARY</span>



                    <strong>

                      {count('meta')} <small>/ 20</small>

                    </strong>

                  </div>



                  <div>

                    <span>QUALITY THRESHOLD</span>



                    <strong>

                      60<small>/100</small>

                    </strong>

                  </div>

                </div>



                {(search.issues || []).length > 0 && (

                  <div className="notice warning">

                    <AlertTriangle size={18} />



                    <div>

                      <strong>

                        Coverage / quality limitations

                      </strong>



                      {search.issues.map((issue, index) => (

                        <p key={index}>{issue}</p>

                      ))}

                    </div>

                  </div>

                )}



           



                {previews.length > 0 && (

                  <section

                    className="results"

                    style={{ marginTop: 18 }}

                  >

                    <div className="resultsTop">

                      <div>

                        <span className="eyebrow">

                          REAL SOURCE CANDIDATES · NOT AI

                          VERIFIED

                        </span>



                        <h2>

                          Collected video previews

                        </h2>



                        <p className="muted">

                          These are source-discovered videos

                          awaiting product-image verification.

                          They are not exact-product matches

                          and do not count toward the 20/20

                          goal. Open the original to review.

                        </p>

                      </div>

                    </div>



                    <div

                      className="tabs"

                      style={{ margin: '12px 0' }}

                    >

                      <button

                        className={

                          tab === 'instagram'

                            ? 'current'

                            : ''

                        }

                        onClick={() =>

                          setTab('instagram')

                        }

                      >

                        Instagram candidates (

                        {previewCount('instagram')})

                      </button>



                      <button

                        className={

                          tab === 'meta'

                            ? 'current'

                            : ''

                        }

                        onClick={() => setTab('meta')}

                      >

                        Meta candidates (

                        {previewCount('meta')})

                      </button>

                    </div>



                    <div className="grid">

                      {previews

                        .filter(

                          (value) =>

                            value.platform === tab

                        )

                        .map((value, index) => (

                          <article

                            className="videoCard"

                            key={

                              (value.identity ||

                                value.id ||

                                index) + 'preview'

                            }

                          >

                            <div className="thumb">

                              {value.thumbnail ? (

                                <img

                                  loading="lazy"

                                  src={value.thumbnail}

                                  alt="Source video thumbnail"

                                  onError={(e) => {

                                    e.currentTarget.style.display =

                                      'none';

                                  }}

                                />

                              ) : (

                                <div className="noThumb">

                                  <Video size={38} />

                                </div>

                              )}



                              <span className="sourceTag">

                                {value.platform ===

                                'meta'

                                  ? 'Meta video candidate'

                                  : 'Instagram video candidate'}

                              </span>

                            </div>



                            <div className="cardBody">

                              <div className="match">

                                <span className="unverified">

                                  NOT VISUALLY VERIFIED

                                </span>

                              </div>



                              <p className="caption">

                                {value.caption ||

                                  'No caption available'}

                              </p>



                              <div className="reason">

                                <BrainCircuit size={15} />



                                {value.match?.reason ||

                                  'Verification pending'}

                              </div>



                              <a

                                href={value.url}

                                target="_blank"

                                rel="noopener noreferrer"

                              >

                                Open original

                                <ExternalLink size={15} />

                              </a>

                            </div>

                          </article>

                        ))}

                    </div>



                    {previewCount(tab) === 0 && (

                      <p className="muted">

                        No collected previews for this

                        source in this search.

                      </p>

                    )}

                  </section>

                )}
     <section className="results">

                  <div className="resultsTop">

                    <div>

                      <span className="eyebrow">

                        DISCOVERY RESULTS

                      </span>



                      <h2>Video intelligence feed</h2>

                    </div>



                    <label className="toggle">

                      <input

                        type="checkbox"

                        checked={showSeen}

                        onChange={(e) =>

                          setShowSeen(e.target.checked)

                        }

                      />



                      Show previously seen

                    </label>

                  </div>



                  <div className="toolbar">

                    <div className="tabs">

                      <button

                        className={

                          tab === 'instagram'

                            ? 'current'

                            : ''

                        }

                        onClick={() =>

                          setTab('instagram')

                        }

                      >

                        <Instagram size={17} />

                        Instagram

                        <span>

                          {count('instagram')}/20

                        </span>

                      </button>



                      <button

                        className={

                          tab === 'meta' ? 'current' : ''

                        }

                        onClick={() => setTab('meta')}

                      >

                        <Megaphone size={17} />

                        Meta Ad Library

                        <span>{count('meta')}/20</span>

                      </button>

                    </div>



                    <div className="filters">

                      <Filter size={17} />



                      <select

                        aria-label="Minimum match score"

                        value={min}

                        onChange={(e) =>

                          setMin(Number(e.target.value))

                        }

                      >

                        <option value="0">

                          All scores

                        </option>

                        <option value="60">

                          60+ match

                        </option>

                        <option value="80">

                          80+ match

                        </option>

                      </select>



                      <select

                        aria-label="Sort results"

                        value={sort}

                        onChange={(e) =>

                          setSort(e.target.value)

                        }

                      >

                        <option value="score">

                          Highest match

                        </option>



                        <option value="newest">

                          Newest first

                        </option>

                      </select>

                    </div>

                  </div>



                  {entries.length === 0 ? (

                    <div className="empty">

                      <Video size={38} />



                      <h3>

                        No verified visual matches yet

                      </h3>



                      <p>

                        {previews.length

                          ? `${previews.length} collected candidates await verification. They are shown separately below, not as product matches.`

                          : 'No candidates passed image verification. Review the source diagnostics or try a more specific product or brand query.'}

                      </p>

                    </div>

                  ) : (

                    <div className="grid">

                      {entries.map((value, index) => (

                        <article

                          className="videoCard"

                          key={

                            (value.identity ||

                              value.id ||

                              index) + String(index)

                          }

                        >

                          <div className="thumb">

                            {value.thumbnail ? (

                              <img

                                loading="lazy"

                                src={value.thumbnail}

                                alt="Video thumbnail"

                              />

                            ) : (

                              <div className="noThumb">

                                <Video size={40} />

                              </div>

                            )}



                            <span className="sourceTag">

                              {value.platform ===

                              'instagram'

                                ? value.isConfirmedReel

                                  ? 'Reel'

                                  : 'Instagram video'

                                : 'Meta Ad'}

                            </span>



                            {value.isDemo && (

                              <span className="demoTag">

                                SAMPLE — NOT REAL

                              </span>

                            )}



                            {value.previous && (

                              <span className="seenTag">

                                PREVIOUSLY SEEN

                              </span>

                            )}

                          </div>



                          <div className="cardBody">

                            <div className="match">

                              <span

                                className={

                                  value.match.verified

                                    ? 'verified'

                                    : 'unverified'

                                }

                              >

                                {value.match.verified

                                  ? 'AI VISUAL MATCH'

                                  : 'NOT VISUALLY VERIFIED'}

                              </span>



                              <strong>

                                {value.match?.verified ? (

                                  <>

                                    {value.match.score}

                                    <small>/100</small>

                                  </>

                                ) : (

                                  'Pending'

                                )}

                              </strong>

                            </div>



                            <p className="caption">

                              {value.caption ||

                                'No caption available'}

                            </p>



                            <div className="reason">

                              <BrainCircuit size={15} />



                              {value.match?.reason ||

                                'Awaiting product verification'}

                            </div>



                            <a

                              href={value.url}

                              target="_blank"

                              rel="noopener noreferrer"

                            >

                              Open original

                              <ExternalLink size={15} />

                            </a>

                          </div>

                        </article>

                      ))}

                    </div>

                  )}

                </section>
              </>

            )}

          </>

        )}



        {!search && (

          <div className="welcome">

            <div className="welcomeIcon">

              <BrainCircuit size={32} />

            </div>



            <h2>

              Your next winning creative starts here.

            </h2>



            <p>

              Search a product, let the AI inspect its

              visual identity, then explore sourced Reels

              and advertisements with explainable match

              scores.

            </p>



            <div className="steps">

              <span>01 &nbsp; Identify product</span>



              <ChevronRight size={16} />



              <span>02 &nbsp; Collect creative</span>



              <ChevronRight size={16} />



              <span>03 &nbsp; Verify matches</span>

            </div>

          </div>

        )}

      </main>

    </div>

  );

}



createRoot(document.getElementById('root')).render(<App />);
