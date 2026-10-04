import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  listCommonProjects,
  CommonProjectSummary,
  CommonProjectsListResponse,
  ApiError,
} from "@/lib/api";

const PAGE_SIZE = 20;

export default function CommonProjectsPage() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [projects, setProjects] = useState<CommonProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"newest" | "popular" | "author">("newest");
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);

  const loadProjects = async (
    query: string,
    tags: string[],
    sort: string,
    page: number,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const response = await listCommonProjects({
        q: query || undefined,
        tag: tags.length > 0 ? tags : undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        token,
      });
      setProjects(response.projects || []);
      setTotal(response.total || 0);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(`Error: ${e.status} — ${e.message}`);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load projects");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects(searchQuery, selectedTags, sortBy, 0);
    setOffset(0);
  }, [searchQuery, selectedTags, sortBy, token]);

  const currentPage = offset / PAGE_SIZE;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    setOffset(0);
  };

  const handleTagChange = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
    setOffset(0);
  };

  const handleImport = async (projectId: string) => {
    if (!token) {
      navigate("/login");
      return;
    }
    // TODO: Implement conflict handling dialog
    navigate(`/trust/common/${projectId}/import`);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages - 1) {
      const newOffset = (currentPage + 1) * PAGE_SIZE;
      setOffset(newOffset);
      loadProjects(searchQuery, selectedTags, sortBy, currentPage + 1);
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 0) {
      const newOffset = (currentPage - 1) * PAGE_SIZE;
      setOffset(newOffset);
      loadProjects(searchQuery, selectedTags, sortBy, currentPage - 1);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Common Projects</h1>
          <p className="text-gray-600">
            Explore and import projects shared by the community.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search & Filters */}
        <div className="mb-8">
          <div className="mb-4">
            <input
              type="text"
              placeholder="Search by title or description..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {["tutorial", "guide", "reference", "practice"].map((tag) => (
              <button
                key={tag}
                onClick={() => handleTagChange(tag)}
                className={`px-3 py-1 rounded-full text-sm font-medium transition ${
                  selectedTags.includes(tag)
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Sort by:</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "newest" | "popular" | "author")}
              className="px-3 py-1 border border-gray-300 rounded-lg text-sm"
            >
              <option value="newest">Newest</option>
              <option value="popular">Popular</option>
              <option value="author">Author</option>
            </select>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="p-4 bg-gray-200 rounded-lg animate-pulse h-64"
              />
            ))}
          </div>
        )}

        {/* Projects Grid */}
        {!loading && projects.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="border border-gray-200 rounded-lg p-6 hover:shadow-lg transition"
                >
                  <h3 className="text-lg font-semibold text-gray-900 mb-2 line-clamp-2">
                    {project.title}
                  </h3>

                  {project.description && (
                    <p className="text-sm text-gray-600 mb-4 line-clamp-3">
                      {project.description.substring(0, 100)}
                      {project.description.length > 100 ? "..." : ""}
                    </p>
                  )}

                  <div className="mb-4 text-xs text-gray-500">
                    <p>By {project.author_name}</p>
                    <p>
                      {new Date(project.created_at).toLocaleDateString()}
                    </p>
                  </div>

                  {project.tags && project.tags.length > 0 && (
                    <div className="mb-4 flex flex-wrap gap-1">
                      {project.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="inline-block px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2 pt-4 border-t border-gray-200">
                    <button
                      onClick={() =>
                        navigate(`/trust/common/${project.id}`)
                      }
                      className="flex-1 px-4 py-2 text-sm font-medium text-blue-600 border border-blue-600 rounded hover:bg-blue-50 transition"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleImport(project.id)}
                      className={`flex-1 px-4 py-2 text-sm font-medium rounded transition ${
                        token
                          ? "bg-blue-600 text-white hover:bg-blue-700"
                          : "bg-gray-300 text-gray-600 cursor-not-allowed"
                      }`}
                      disabled={!token}
                    >
                      Import
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <button
                  onClick={handlePrevPage}
                  disabled={currentPage === 0}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-sm text-gray-600">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <button
                  onClick={handleNextPage}
                  disabled={currentPage >= totalPages - 1}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}

        {/* Empty State */}
        {!loading && projects.length === 0 && (
          <div className="text-center py-12">
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No projects found
            </h3>
            <p className="text-gray-600 mb-6">
              Try adjusting your search or filters.
            </p>
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedTags([]);
                setSortBy("newest");
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
