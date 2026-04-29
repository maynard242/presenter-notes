import { useState, useMemo } from "react";
import { Link } from "wouter";
import { 
  useListNotes, 
  getListNotesQueryKey, 
  useGetNotesStats, 
  getGetNotesStatsQueryKey,
  useListEvents,
  getListEventsQueryKey
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Calendar, FileText, User, PenTool } from "lucide-react";
import { format } from "date-fns";
import UploadModal from "@/components/upload-modal";
import CreateNoteModal from "@/components/create-note-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { useClerk } from "@clerk/react";

export default function NotesList() {
  const [search, setSearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<string | undefined>(undefined);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const { signOut } = useClerk();

  const { data: notes, isLoading: isLoadingNotes } = useListNotes(
    { search: search || undefined, event: selectedEvent },
    { query: { queryKey: getListNotesQueryKey({ search: search || undefined, event: selectedEvent }) } }
  );

  const { data: stats, isLoading: isLoadingStats } = useGetNotesStats(
    { query: { queryKey: getGetNotesStatsQueryKey() } }
  );

  const { data: eventsList, isLoading: isLoadingEvents } = useListEvents(
    { query: { queryKey: getListEventsQueryKey() } }
  );

  // Group notes by month/year
  const groupedNotes = useMemo(() => {
    if (!notes) return {};
    return notes.reduce((acc, note) => {
      const date = note.eventDate ? new Date(note.eventDate) : new Date(note.createdAt);
      const key = format(date, "MMMM yyyy");
      if (!acc[key]) acc[key] = [];
      acc[key].push(note);
      return acc;
    }, {} as Record<string, typeof notes>);
  }, [notes]);

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="border-b border-border bg-card/50 sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="48" height="48" rx="12" fill="#E68A00" />
              <path d="M14 16H34M14 24H34M14 32H24" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <span className="font-serif font-semibold text-lg">Presenter Notes</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => signOut()} aria-label="Sign out">
            <User className="h-5 w-5 text-muted-foreground" />
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8 pb-24">
        {/* Stats & Actions */}
        <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center justify-between">
          <div className="flex gap-6">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Total Notes</p>
              <p className="text-2xl font-serif">
                {isLoadingStats ? <Skeleton className="h-8 w-12" /> : stats?.totalNotes || 0}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Events</p>
              <p className="text-2xl font-serif">
                {isLoadingStats ? <Skeleton className="h-8 w-12" /> : stats?.totalEvents || 0}
              </p>
            </div>
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <Button variant="outline" onClick={() => setIsCreateOpen(true)} className="flex-1 sm:flex-none shadow-sm">
              <PenTool className="mr-2 h-4 w-4" />
              Write Note
            </Button>
            <Button onClick={() => setIsUploadOpen(true)} className="flex-1 sm:flex-none shadow-sm">
              <Plus className="mr-2 h-4 w-4" />
              Upload Markdown
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input 
              placeholder="Search notes..." 
              className="pl-10 h-12 text-base bg-card border-border shadow-sm rounded-xl"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Badge 
              variant={selectedEvent === undefined ? "default" : "secondary"}
              className="cursor-pointer text-sm py-1.5 px-3 rounded-full font-medium"
              onClick={() => setSelectedEvent(undefined)}
            >
              All Events
            </Badge>
            {isLoadingEvents ? (
              <Skeleton className="h-8 w-24 rounded-full" />
            ) : (
              eventsList?.events.map(event => (
                <Badge 
                  key={event}
                  variant={selectedEvent === event ? "default" : "secondary"}
                  className="cursor-pointer text-sm py-1.5 px-3 rounded-full font-medium bg-card border border-border hover:bg-muted"
                  onClick={() => setSelectedEvent(event === selectedEvent ? undefined : event)}
                >
                  {event}
                </Badge>
              ))
            )}
          </div>
        </div>

        {/* Note List */}
        <div className="space-y-10">
          {isLoadingNotes ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
            </div>
          ) : notes && notes.length > 0 ? (
            Object.entries(groupedNotes).map(([monthYear, monthNotes]) => (
              <div key={monthYear} className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
                <h2 className="text-lg font-serif font-medium text-muted-foreground flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {monthYear}
                </h2>
                <div className="grid gap-4">
                  {monthNotes.map((note) => (
                    <Link 
                      key={note.id} 
                      href={`/notes/${note.id}`}
                      className="group block bg-card hover:bg-muted/30 border border-border rounded-2xl p-5 transition-all hover:shadow-md no-default-hover-elevate"
                    >
                      <div className="flex flex-col gap-3">
                        <div className="space-y-1">
                          <h3 className="text-xl font-serif font-semibold text-foreground group-hover:text-primary transition-colors">
                            {note.title}
                          </h3>
                          {note.event && (
                            <p className="text-sm font-medium text-primary/80 flex items-center gap-1.5">
                              {note.event}
                              {note.eventDate && (
                                <span className="text-muted-foreground font-normal">
                                  • {format(new Date(note.eventDate), "MMM d, yyyy")}
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                        {note.tags && note.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {note.tags.map(tag => (
                              <span key={tag} className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-20 px-4 border-2 border-dashed border-border rounded-2xl bg-card/30">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-4 opacity-50" />
              <h3 className="text-lg font-serif font-medium mb-1">No notes found</h3>
              <p className="text-muted-foreground">
                {search || selectedEvent ? "Try adjusting your search or filters." : "Upload a markdown file to get started."}
              </p>
            </div>
          )}
        </div>
      </main>

      <UploadModal open={isUploadOpen} onOpenChange={setIsUploadOpen} />
      <CreateNoteModal open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </div>
  );
}