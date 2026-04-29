import { useParams, Link, useLocation } from "wouter";
import { useGetNote, getGetNoteQueryKey, useDeleteNote } from "@workspace/api-client-react";
import { ArrowLeft, Calendar, Tag, Trash2, Edit } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import EditNoteModal from "@/components/edit-note-modal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";

export default function NoteDetail() {
  const { id } = useParams<{ id: string }>();
  const noteId = parseInt(id || "0", 10);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [isEditOpen, setIsEditOpen] = useState(false);

  const { data: note, isLoading } = useGetNote(noteId, {
    query: { enabled: !!noteId, queryKey: getGetNoteQueryKey(noteId) }
  });

  const deleteMutation = useDeleteNote({
    mutation: {
      onSuccess: () => {
        // Clear queries and go back to list
        queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
        setLocation("/notes");
      }
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <header className="h-16 border-b border-border bg-card flex items-center px-4">
          <Skeleton className="h-8 w-8 rounded-full" />
        </header>
        <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-6 w-1/3" />
          <div className="space-y-4 pt-8">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </main>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center p-4">
        <h1 className="text-2xl font-serif mb-4">Note not found</h1>
        <Link href="/notes" className="text-primary hover:underline flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" /> Return to notes
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <header className="h-16 border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 h-full flex items-center justify-between">
          <Link href="/notes" className="inline-flex items-center justify-center h-10 w-10 rounded-full hover:bg-muted transition-colors -ml-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setIsEditOpen(true)} className="text-muted-foreground hover:text-foreground hover:bg-muted">
              <Edit className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete note?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete this note. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={() => deleteMutation.mutate({ id: noteId })}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <article className="space-y-8">
          {/* Header section */}
          <div className="space-y-4">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-semibold text-foreground leading-tight tracking-tight">
              {note.title}
            </h1>
            
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm sm:text-base font-medium text-muted-foreground">
              {note.event && (
                <div className="flex items-center gap-2 text-primary/90">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block"></span>
                  {note.event}
                </div>
              )}
              {note.eventDate && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 opacity-70" />
                  {format(new Date(note.eventDate), "MMMM d, yyyy")}
                </div>
              )}
            </div>

            {note.tags && note.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {note.tags.map(tag => (
                  <div key={tag} className="flex items-center gap-1 text-xs font-mono bg-muted/60 text-muted-foreground px-2.5 py-1 rounded-md border border-border">
                    <Tag className="h-3 w-3 opacity-60" />
                    {tag}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="h-px w-full bg-border" />

          {/* Content section */}
          <div className="prose prose-lg dark:prose-invert prose-stone max-w-none 
                          prose-headings:font-serif prose-headings:font-medium prose-headings:tracking-tight
                          prose-p:leading-relaxed prose-p:text-foreground/90 
                          prose-li:text-foreground/90 prose-li:leading-relaxed
                          prose-a:text-primary prose-a:underline-offset-4
                          prose-strong:text-foreground prose-strong:font-semibold
                          prose-code:font-mono prose-code:text-primary/90 prose-code:bg-muted/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm
                          prose-pre:bg-card prose-pre:border prose-pre:border-border">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {note.content}
            </ReactMarkdown>
          </div>
        </article>
      </main>

      <EditNoteModal note={note} open={isEditOpen} onOpenChange={setIsEditOpen} />
    </div>
  );
}