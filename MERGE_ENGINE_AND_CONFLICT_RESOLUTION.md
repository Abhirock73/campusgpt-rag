# Comprehensive Guide: Merge Engine, Line-by-Line Diff & Conflict Resolution

This document provides a deep, technical breakdown of how modern Version Control Systems (like **Git** and **VGIT**) implement their **Merge Engine**, detect **line-by-line differences**, and handle **Conflict Resolution**.

---

## 1. Why is a Merge Engine Needed?

### The Core Problem in Version Control
In any collaborative software project, developers branch off from a common codebase to develop features, patch bugs, or refactor code independently.

```
       C --- D  (Feature Branch - "Theirs")
      /
A --- B         (Common Ancestor - "Base")
      \
       E --- F  (Main Branch - "Ours")
```

When work finishes, the divergent branches must be recombined into a single unified state. Without an automated, robust Merge Engine:
1. **Blind Overwriting:** If developer A pushes files changed by developer B, the second push would completely erase the first developer's contributions.
2. **Manual Copy-Paste Errors:** Humans would have to manually compare thousands of lines across dozens of files, introducing subtle syntax errors and regressions.
3. **Loss of History & Attribution:** Tracking which change came from where and why it was introduced becomes impossible.

The Merge Engine's goal is to **automatically combine changes that do not interfere with each other** and **reliably flag any overlapping, contradictory changes** so that humans can resolve them without silent data corruption.

---

## 2. Evolution of Merge Strategies: 2-Way vs. 3-Way Merge

### 2.1 Why Two-Way Merge Fails
A naive approach is to compare two files directly: `File_A` (Ours) and `File_B` (Theirs).

| Line in Ours (`A`) | Line in Theirs (`B`) | What Happened? |
| :--- | :--- | :--- |
| `print("Hello World")` | *(Line missing)* | Did `A` add this line, or did `B` delete it? |
| `timeout = 5000` | `timeout = 3000` | Which one is the newer value? |

**Conclusion:** Without a reference point, it is logically impossible to know whether a difference represents an **addition**, a **deletion**, or a **modification**.

---

### 2.2 Three-Way Merge: The Industry Standard
A **Three-Way Merge** uses three inputs:
1. **Base ($O$):** The snapshot at the **Lowest Common Ancestor (LCA)** commit where the two branches originally split.
2. **Ours ($A$):** The snapshot at the current branch (`HEAD`).
3. **Theirs ($B$):** The snapshot at the branch being merged into the current branch.

```
                     +---------------------------+
                     | Common Ancestor: Base (O) |
                     +---------------------------+
                                   |
                  +----------------+----------------+
                  |                                 |
                  v                                 v
        +-------------------+             +-------------------+
        | Current: Ours (A) |             | Target: Theirs(B) |
        +-------------------+             +-------------------+
                  |                                 |
                  +----------------+----------------+
                                   |
                                   v
                      +-------------------------+
                      |   3-Way Merge Result    |
                      +-------------------------+
```

#### The 3-Way Merge Decision Matrix (Per Line or Hunk)

| Base ($O$) | Ours ($A$) | Theirs ($B$) | Action Taken | Status |
| :--- | :--- | :--- | :--- | :--- |
| `val = 10` | `val = 10` | `val = 10` | Keep `val = 10` | **Clean** (No change) |
| `val = 10` | `val = 20` | `val = 10` | Take `val = 20` | **Clean** (Only Ours changed) |
| `val = 10` | `val = 10` | `val = 30` | Take `val = 30` | **Clean** (Only Theirs changed) |
| `val = 10` | `val = 20` | `val = 20` | Take `val = 20` | **Clean** (Both made identical edit) |
| *(absent)* | `new_func()` | *(absent)* | Take `new_func()` | **Clean** (Ours added a line) |
| *(absent)* | *(absent)* | `new_func()` | Take `new_func()` | **Clean** (Theirs added a line) |
| `old_code()`| *(deleted)* | `old_code()`| Delete line | **Clean** (Ours deleted a line) |
| `val = 10` | `val = 20` | `val = 30` | **Generate Conflict Markers** | ⚠️ **CONFLICT** (Both changed differently) |
| `val = 10` | *(deleted)* | `val = 30` | **Generate Conflict Markers** | ⚠️ **CONFLICT** (Delete vs Modify) |

---

## 3. How the Common Ancestor (Merge Base) is Found

Before any file comparison begins, the VCS must identify the commit that represents the **Lowest Common Ancestor (LCA)** in the commit Directed Acyclic Graph (DAG).

```
Commit Graph Example:
       (c1) -> (c2) -> (c3) -> (c5)  [Branch: feature]
                 ^
                 |
               (c0) -> (c4) -> (c6)  [Branch: main]
```

1. **Commit Traversal:** Using Breadth-First Search (BFS) or topological sorting, the engine traverses backward from commit `c5` and commit `c6`.
2. **Ancestor Intersection:** It collects all common ancestors (`c2` and `c0`).
3. **Lowest Ancestor:** It picks the common ancestor that is reachable from all other common ancestors (here, `c2`).
4. **Criss-Cross Merges & Recursive Merge:**
   - In complex branch topologies, there may be **multiple LCAs** with no single descendant.
   - Modern Git uses the **Recursive Merge Strategy (`merge-ort` or `merge-recursive`)**: it recursively merges the two common ancestors to create a **virtual common ancestor commit**, and uses that virtual commit as the Base $O$ for the real merge.

---

## 4. How Line-by-Line Differences are Detected

To compare Base with Ours, or Base with Theirs, the VCS must compute an exact line-by-line diff. This is handled by **Diff Algorithms**.

### 4.1 Problem Definition: Shortest Edit Script (SES)
Given two sequences of lines:
- $A = [a_1, a_2, \dots, a_N]$
- $B = [b_1, b_2, \dots, b_M]$

Find the minimal sequence of edit operations (**insertions** and **deletions**) that transforms sequence $A$ into sequence $B$.
This problem is mathematically dual to finding the **Longest Common Subsequence (LCS)**.

---

### 4.2 The Myers Diff Algorithm (Eugene W. Myers, 1986)
The **Myers Diff Algorithm** is the default and fastest diff engine used by Git and modern developer tools.

#### The Edit Graph Concept
Imagine an $(N+1) \times (M+1)$ grid where:
- The **X-axis** represents lines of file $A$ (length $N$).
- The **Y-axis** represents lines of file $B$ (length $M$).
- The top-left corner is $(0, 0)$ and the bottom-right target is $(N, M)$.

```
   (0,0) ----X (Lines in A)----> (N,0)
     |  \                         |
     |    \ (Free diagonal snake) |
     Y      \                     |
  (Lines in B)                    |
     v                            v
   (0,M) ---------------------- (N,M)
```

#### Movement Rules on the Grid:
1. **Horizontal Move $(x \to x+1, y)$:** Corresponds to **deleting** line $A[x+1]$. Cost = $1$.
2. **Vertical Move $(x, y \to y+1)$:** Corresponds to **inserting** line $B[y+1]$. Cost = $1$.
3. **Diagonal Move $(x \to x+1, y \to y+1)$:** Occurs whenever line $A[x+1] == B[y+1]$ (the lines are identical). **Cost = 0!** (This is known as a **Snake**).

The algorithm performs a Breadth-First Search (BFS) parameterized by **$D$ (the total edit distance / number of non-diagonal moves)**:
- $D = 0$: Can we reach $(N, M)$ using only free diagonals?
- $D = 1$: Can we reach it with 1 insertion or 1 deletion + free diagonals?
- $D = 2, 3, \dots$

#### Diagonal Indexing: $k = x - y$
At each point $(x, y)$, the diagonal line is identified by $k = x - y$:
- A horizontal step (delete) moves from diagonal $k-1$ to $k$.
- A vertical step (insert) moves from diagonal $k+1$ to $k$.

Because Myers searches by increasing $D$, it is guaranteed to find the **Shortest Edit Script (SES)** in $O(ND)$ time (where $N$ is file length and $D$ is the count of differences). For typical source files where $D \ll N$, Myers runs almost in linear time.

---

### 4.3 Forming Diffs into "Hunks"
Once the optimal path through the edit graph is determined, the changes are grouped into contiguous blocks called **Hunks**:
```diff
@@ -10,6 +10,7 @@
 context line 1
 context line 2
-deleted line
+added line A
+added line B
 context line 3
```
Each hunk contains:
- The original start line and line count (`-10,6`).
- The new start line and line count (`+10,7`).
- Leading and trailing **context lines** (usually 3 lines) to anchor the change uniquely within the file.

---

## 5. End-to-End Conflict Resolution Mechanism

When merging branch `feature` into `main`:

### Step 1: Compute Two Independent Diffs
The Merge Engine computes:
1. $\Delta_A = \text{Diff}(\text{Base } O, \text{Ours } A)$
2. $\Delta_B = \text{Diff}(\text{Base } O, \text{Theirs } B)$

### Step 2: Line Hunk Alignment
The engine walks through the file line by line using cursor offsets, checking which lines were altered by $\Delta_A$ and $\Delta_B$:

```
Line Range: [L_start ... L_end] in Base (O)

Case 1: Range untouched by both
   -> Output Base content unchanged.

Case 2: Range modified only by Delta_A (Ours)
   -> Output Ours content.

Case 3: Range modified only by Delta_B (Theirs)
   -> Output Theirs content.

Case 4: Range modified by both Delta_A and Delta_B
   -> Check if changes are identical:
         If Ours_content == Theirs_content:
             Output Ours_content (Clean Auto-Merge)
         Else:
             OVERLAPPING EDIT DETECTED -> CONFLICT!
```

---

### Step 3: Conflict Marker Injection
When Case 4 occurs, the engine halts automatic merging for that specific file and writes **Conflict Markers** directly into the working directory file:

```text
<<<<<<< HEAD
const API_URL = "https://production.nitkkr.ac.in/api/v1";
const TIMEOUT_MS = 10000;
=======
const API_URL = "https://staging.nitkkr.ac.in/api/v2";
const TIMEOUT_MS = 5000;
>>>>>>> feature/new-api-endpoint
```

#### What the Conflict Markers Mean:
- `<<<<<<< HEAD`: Marks the start of the conflict. The code directly below this is what currently exists in your current branch (`Ours`).
- `=======`: The separator separating the two conflicting versions.
- `>>>>>>> <branch_name>`: The code above this is what incoming branch (`Theirs`) wanted to put here.

#### Diff3 Mode (Showing Base Code)
Advanced developers often configure `merge.conflictstyle = diff3`, which includes the original Base text between the two versions:
```text
<<<<<<< HEAD
const API_URL = "https://production.nitkkr.ac.in/api/v1";
||||||| merged common ancestors
const API_URL = "http://localhost:5000/api";
=======
const API_URL = "https://staging.nitkkr.ac.in/api/v2";
>>>>>>> feature/new-api-endpoint
```
This enables the developer to instantly see:
1. What it was originally (`localhost`).
2. What Developer 1 changed it to (`production`).
3. What Developer 2 changed it to (`staging`).

---

## 6. Types of Conflicts Beyond Line Clashes

A complete VCS merge engine handles more than just line-by-line text conflicts:

| Conflict Type | Description | Resolution Workflow |
| :--- | :--- | :--- |
| **Content Conflict** | Both branches edited the same line or hunk differently. | Developer edits file, removes markers, stages file. |
| **Modify / Delete Conflict** | Branch A edited `utils.js`, but Branch B deleted `utils.js`. | Developer decides whether to retain the modified file or confirm deletion. |
| **File Rename Conflict** | Branch A renamed `auth.js` to `login.js`, while Branch B modified `auth.js`. | Engine detects rename (via similarity hashes) and applies edits to `login.js`. |
| **Rename / Rename Conflict** | Branch A renamed `x.js` to `y.js`, but Branch B renamed `x.js` to `z.js`. | Developer chooses final destination filename. |
| **File Mode / Permission Conflict** | Branch A changed permissions to `755` (executable), Branch B kept `644`. | Developer reconciles file mode. |

---

## 7. How the Git Index (Staging Area) Tracks Conflicts

Internally, Git's staging area (the index) uses **Stages** (numbered 0 to 3) to represent file states during a conflict:

- **Stage 0:** Normal, unconflicted state.
- **Stage 1:** The file as it exists in **Base (LCA)**.
- **Stage 2:** The file as it exists in **Ours (`HEAD`)**.
- **Stage 3:** The file as it exists in **Theirs (`Incoming`)**.

When a conflict happens, the file is entered into Stages 1, 2, and 3 simultaneously. 
When the developer resolves the conflict and runs:
```bash
git add <filename>
```
Git collapses Stages 1, 2, and 3 into a single **Stage 0** entry containing the final resolution, marking the conflict as resolved.

---

## 8. Summary Checklist of Merge Execution

```
[Start Merge]
       │
       ▼
1. Identify Target Branch commit & Current Branch commit
       │
       ▼
2. Find Lowest Common Ancestor (LCA) commit -> Base (O)
       │
       ├─ If Base == Theirs -> Already up to date.
       ├─ If Base == Ours   -> Fast-Forward merge (advance HEAD pointer).
       │
       ▼
3. Run Three-Way Merge Engine
       │
       ├─ Compare file trees (Detect Added, Deleted, Renamed files)
       │
       ▼
4. For each modified file: Run Myers Diff Algorithm
       │
       ├─ Diff(Base, Ours)
       ├─ Diff(Base, Theirs)
       │
       ▼
5. Intersect Hunks:
       ├─ Independent edits  -> Auto-merged cleanly into target
       └─ Overlapping edits  -> Inject <<<<<<<, =======, >>>>>>> markers
       │
       ▼
6. Write conflict state to Staging Index (Stages 1, 2, 3)
       │
       ▼
[Await Developer Resolution & Commit]
```
