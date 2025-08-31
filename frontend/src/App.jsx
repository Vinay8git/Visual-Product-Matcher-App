import React, { useState } from "react";
import "./App.css";


const App = () => {
  // Search State
  const [file, setFile] = useState(null);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState(null);
  const [topK, setTopK] = useState(12);
  const [minScore, setMinScore] = useState(0);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  // Add Product State
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newPreview, setNewPreview] = useState(null);
  const [addMessage, setAddMessage] = useState("");
  const API_BASE = import.meta.env.VITE_API_BASE_URL;

  // Handle search file upload
  const handleFileChange = (e) => {
    const f = e.target.files[0];
    setFile(f);
    if (f) setPreview(URL.createObjectURL(f));
  };

  // Handle search URL input
  const handleUrlChange = (e) => {
    const value = e.target.value.trim();
    setUrl(value);
    setPreview(value || null);
  };

  // Submit search request
  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus("Searching...");
    setError("");
    setResults([]);

    const fd = new FormData();
    if (file) fd.append("file", file);
    if (url) fd.append("url", url);
    fd.append("top_k", topK);
    fd.append("min_score", minScore / 100);

    try {
      const resp = await fetch(`${API_BASE}/search`, {
        method: "POST",
        body: fd,
      });
      const data = await resp.json();
      setStatus("");
      if (!resp.ok) {
        setError(data.error || "Search Failed");
        return;
      }
      setResults(data.results || []);
    } catch (err) {
      setStatus("");
      setError(err.message);
    }
  };

  // Handle add product URL input + preview
  const handleNewUrlChange = (e) => {
    const value = e.target.value.trim();
    setNewUrl(value);
    setNewPreview(value || null);
  };

  // Submit add product request
  const handleAddProduct = async (e) => {
    e.preventDefault();
    setAddMessage("Adding product & Rebuilding Index...");

    try {
      const resp = await fetch(`${API_BASE}/api/add-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName,
          category: newCategory,
          image_url: newUrl,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setAddMessage("❌ " + (data.error || "Failed To Add Product"));
        return;
      }
      setAddMessage("✅ Product Added & Index Rebuilt Successfully!");
      setNewName("");
      setNewCategory("");
      setNewUrl("");
      setNewPreview(null);
    } catch (err) {
      setAddMessage("❌ " + err.message);
    }
  };

  return (
    <div className="container">
      <header>
        <h1>Visual Product Matcher</h1>
        <p>Upload an image or paste an image URL to find similar products.</p>
      </header>

      {/*Search Products Section */}
      <section className="search-preview">
        <div className="form-container">
          <h2>Search Products</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Image File</label>
              <div className="file-upload">
                <label className="file-label">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                  />
                  <span className="file-text">
                    {file ? file.name : "Click To Upload"}
                  </span>
                </label>
              </div>
            </div>

            <div className="form-group">
              <label>Or Image URL</label>
              <input
                type="url"
                placeholder="https://..."
                value={url}
                onChange={handleUrlChange}
              />
            </div>

            <div className="form-group range-group">
              <div>
                <label>
                  Top K: <span>{topK}</span>
                </label>
                <input
                  type="range"
                  min="2"
                  max="10"
                  value={topK}
                  onChange={(e) => setTopK(e.target.value)}
                />
              </div>
              <div>
                <label>
                  Min Similarity Score:{" "}
                  <span>{(minScore / 100).toFixed(2)}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={minScore}
                  onChange={(e) => setMinScore(e.target.value)}
                />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit">Search</button>
            </div>
          </form>
        </div>

        <div className="preview-container">
          <h2>Preview</h2>
          <div className="preview-box">
            {preview ? (
              <img src={preview} alt="Preview" />
            ) : (
              <span>No Image</span>
            )}
          </div>
        </div>
      </section>
      
      {/* Results Section */}
      <section className="status-results">
        {status && <div className="status">{status}</div>}
        {error && <div className="error">{error}</div>}

        <div className="results">
          {results.length === 0 && !status && <p>No Results</p>}
          {results.map((r, idx) => (
            <article key={idx} className="result-card">
              <img src={r.image_url} alt={r.name} />
              <div className="result-info">
                <h3>{r.name}</h3>
                <p>{r.category}</p>
                <p>
                  Score: <span>{r.score.toFixed(3)}</span>
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/*Add Product Section */}
      <section className="search-preview">
        <div className="form-container">
          <h2>Add Product</h2>
          <form onSubmit={handleAddProduct} className="add-form">
            <div className="form-group">
              <label>Product Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Category</label>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Image URL</label>
              <input
                type="url"
                placeholder="https://..."
                value={newUrl}
                onChange={handleNewUrlChange}
                required
              />
            </div>

            <div className="form-actions">
              <button type="submit">Add Product</button>
            </div>
          </form>
          {addMessage && <p className="status">{addMessage}</p>}
        </div>

        <div className="preview-container">
          <h2>Preview</h2>
          <div className="preview-box">
            {newPreview ? (
              <img src={newPreview} alt="New Preview" />
            ) : (
              <span>No Image</span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default App;
