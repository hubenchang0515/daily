> 原文链接：[SQL 的执行顺序：SELECT 其实最后才跑 - 码日新 · 每日文章](https://daily.xplanc.org/zh/sql/SQL-的执行顺序：SELECT-其实最后才跑.md)

---

# SQL 的执行顺序：SELECT 其实最后才跑

写 SQL 的时候，我们从 `SELECT` 开始，往下写 `FROM`、`WHERE`、`GROUP BY`。但数据库在读这条语句时，脑子里走的完全是另一条路线。很多让人抓狂的现象——`WHERE` 里死活用不了刚起的别名、`HAVING` 里能写 `COUNT(*)` 而 `WHERE` 里不能、`ORDER BY` 却又能认出别名——根子都在同一个地方：SQL 的书写顺序和逻辑执行顺序不一致。这不是某个数据库的实现细节，而是语言本身的规定。把它理清楚，能省掉大量靠猜的试错。

## 两个顺序，一张表

先来看同一条查询的两种排列。我们写出来的顺序是：

```
SELECT → FROM → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT
```

而数据库在逻辑上真正处理的顺序是：

```
FROM → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT
```

如果涉及连接，`ON` 和 `JOIN` 紧跟在 `FROM` 之后，把多张表先拼成一张"虚拟表"。展开成表格更直观：

| 步骤 | 子句 | 作用 |
|------|------|------|
| 1 | `FROM` / `JOIN` | 确定数据来源，拼出虚拟表 |
| 2 | `WHERE` | 过滤行 |
| 3 | `GROUP BY` | 分组 |
| 4 | `HAVING` | 过滤组 |
| 5 | `SELECT` | 取列、算表达式、起别名 |
| 6 | `DISTINCT` | 去重 |
| 7 | `ORDER BY` | 排序 |
| 8 | `LIMIT` | 截断 |

这张表是理解后面所有问题的钥匙。记住一句话：**每一步都建立在上一步产出的虚拟表之上**，后面的步骤能看见前面的东西，前面的步骤对后面的东西一无所知。

## FROM：一切的起点

在 `WHERE` 里写 `status = 'paid'` 时，数据库得先知道 `status` 是哪张表的列。所以 `FROM` 必须最先执行，把涉及的表加载进来、按连接条件拼成一张中间结果。只有这张表存在了，后面的过滤、分组才有操作对象。

这也解释了为什么连接条件写在 `ON` 里和写在 `WHERE` 里并不总是一回事——尤其在外连接中，`ON` 决定"谁有资格被拼进来"，而 `WHERE` 是在拼好之后"谁被留下"。这一步的差别会直接影响最终结果的行数。

## WHERE 里的别名，为什么不存在

这是最常踩的坑。看这条查询：

```sql
SELECT price * quantity AS total
FROM orders
WHERE total > 100;
```

`WHERE` 紧跟 `FROM` 执行，此时 `SELECT` 还没轮到，`total` 这个别名自然无处可寻，数据库会直接报"列不存在"。别名是 `SELECT` 这一步才诞生的，而 `WHERE` 在它之前。

可行的写法有三种：

```sql
-- 1. 老老实实重复表达式
SELECT price * quantity AS total
FROM orders
WHERE price * quantity > 100;

-- 2. 用子查询，让别名在外层可见
SELECT total FROM (
    SELECT price * quantity AS total FROM orders
) t
WHERE total > 100;

-- 3. 用 CTE，可读性更好
WITH priced AS (
    SELECT price * quantity AS total FROM orders
)
SELECT total FROM priced WHERE total > 100;
```

第三种写法把"算表达式"和"用表达式过滤"拆成两层，顺序一目了然，是复杂查询里最值得推荐的组织方式。

## HAVING 与 WHERE 的分工

理解了顺序，`WHERE` 和 `HAVING` 的区别就不需要死记了：

```sql
SELECT user_id, COUNT(*) AS cnt
FROM orders
WHERE status = 'paid'
GROUP BY user_id
HAVING COUNT(*) > 5;
```

- `WHERE` 在 `GROUP BY` **之前**，过滤的是一行行的原始记录：`status = 'paid'` 先把未支付的单子挡在门外。
- `GROUP BY` 把剩下的行按 `user_id` 聚成组。
- `HAVING` 在分组**之后**，过滤的是一个个组：`COUNT(*) > 5` 只留下下单超过 5 次的用户。

聚合函数（`COUNT`、`SUM`、`AVG` 等）依赖"一组行"才能计算，而 `WHERE` 执行时根本没有组的概念，所以它里面不能出现聚合函数。想按汇总结果筛选，就得等到 `HAVING`。

一句话记忆：**`WHERE` 过滤行，`HAVING` 过滤组。**

## SELECT 与 DISTINCT：临门一脚

走到 `SELECT` 这一步，虚拟表的结构终于定型：取出指定的列、算好表达式、给列贴上别名。紧接着 `DISTINCT` 对结果去重。

有意思的是 `ORDER BY` 能用列别名，靠的正是这个顺序——别名在 `SELECT` 里生成，`ORDER BY` 在其后执行，当然认得它：

```sql
SELECT price * quantity AS total
FROM orders
ORDER BY total DESC;   -- 完全合法
```

同一个 `total`，放到 `WHERE` 里报错，放到 `ORDER BY` 里却没问题。不是数据库厚此薄彼，纯粹是先后次序不同。

## ORDER BY 和 LIMIT：最后才排队

排序和分页是最后两步。`ORDER BY` 把结果排好序，`LIMIT` / `OFFSET` 再从排好序的结果里截取一段。

这里有个常被忽略的要点：**不带 `ORDER BY` 的 `LIMIT` 结果是不确定的**。因为没有排序，数据库返回行的顺序本身就没有保证，"取前 10 条"每次可能是不同的 10 条。做分页时一定要配上确定的排序键：

```sql
SELECT id, created_at, title
FROM posts
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 40;
```

加上 `id` 作为次级排序键，是为了避免 `created_at` 相同时出现翻页重复或漏行。这同样是理解"结果集如何一步步成型"带来的收益。

## 把顺序串起来走一遍

用一个完整例子复盘：

```sql
SELECT department, COUNT(*) AS headcount
FROM employees
WHERE age < 40
GROUP BY department
HAVING COUNT(*) >= 10
ORDER BY headcount DESC
LIMIT 5;
```

数据库的逻辑流程是：

1. `FROM employees`：加载员工表。
2. `WHERE age < 40`：留下 40 岁以下的员工。
3. `GROUP BY department`：按部门分组。
4. `HAVING COUNT(*) >= 10`：只保留人数不少于 10 的部门。
5. `SELECT department, COUNT(*) AS headcount`：取列、算人数、起别名。
6. `ORDER BY headcount DESC`：按人数降序。
7. `LIMIT 5`：取前 5 个部门。

注意 `headcount` 这个别名只在第 5 步之后才存在，所以它能出现在第 6 步的 `ORDER BY`，却不能出现在第 2 步的 `WHERE`——和前面的结论完全吻合。

## 小结

把执行顺序记成一条流水线，很多"诡异"现象就都合理了：

- **先有表**（`FROM` / `JOIN`），才谈得上过滤；
- **先过滤行**（`WHERE`），再分组（`GROUP BY`），再过滤组（`HAVING`）；
- **别名诞生于 `SELECT`**，因此只有它之后的 `ORDER BY` 能用；
- **聚合函数需要"组"**，所以只能待在 `HAVING`、`SELECT`、`ORDER BY` 这些分组之后的环节；
- **排序在截断之前**，没有 `ORDER BY` 的 `LIMIT` 不可靠。

下次再遇到"明明写了列却说找不到"的报错，先别怀疑人生，回到这条流水线上看看：你引用的东西，在它执行的那个时刻，到底存不存在。

## 相关文章

- [NULL 的三值逻辑：查不到、排不掉、算不准](https://daily.xplanc.org/zh/sql/NULL-的三值逻辑：查不到、排不掉、算不准.md)
- [SQL 实战：LEFT JOIN 之后，行数为什么变多了](https://daily.xplanc.org/zh/sql/SQL-实战：LEFT-JOIN-之后，行数为什么变多了.md)

> 本文由 AI 辅助生成并经人工校验，如有疏漏欢迎指正。
